// Score → stereo audio + timing map.
import { master, measureAudibleUntil, type MasterStats } from "./dsp/master.ts";
import type { InstrumentTable } from "./custom/instruments.ts";
import { expandScore, type NoteEvent } from "./events.ts";
import type { Instrument } from "./instruments/index.ts";
import { midiToFrequency, pitchToMidi } from "./pitch.ts";
import { streamRng } from "./rng.ts";
import { formatPath, JingleScriptError, type Score } from "./score.ts";
import { secondsToSample } from "./time.ts";
import { buildTiming, type TimingMap } from "./timing.ts";
import { NO_SAMPLES, recordingSource, type SampleSource } from "./samples/source.ts";
import * as dmath from "./dsp/math.ts";

export const DEFAULT_SAMPLE_RATE = 48000;
export const SAMPLE_RATES = [44100, 48000] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];

export interface RenderOptions {
  sampleRate?: SampleRate;
  /** Overrides the score's seed. */
  seed?: number;
  /** Recorded samples for sampled instruments (grandpiano), from `await loadSamples(score)`. */
  samples?: SampleSource;
}

export interface RenderResult {
  /** Left and right channels. */
  audio: [Float32Array, Float32Array];
  sampleRate: number;
  timing: TimingMap;
  stats: MasterStats;
}

/** Constant-power pan: equal loudness across the field, −3 dB per side at the centre. */
function panGains(pan: number): [number, number] {
  const angle = (pan * Math.PI) / 2;
  return [dmath.cos(angle), dmath.sin(angle)];
}

interface Voice {
  /** Onset, in samples. */
  start: number;
  samples: Float32Array;
}

/** The pitches an event plays, one voice each (a single unpitched voice when it has none). */
const voicePitches = (event: NoteEvent): (string | undefined)[] => (event.pitches.length > 0 ? event.pitches : [undefined]);

/** Where a voice of an event starts, in samples (a strum spreads a chord's voices). */
const voiceStart = (event: NoteEvent, voice: number, sampleRate: number): number =>
  secondsToSample(event.seconds + (event.strum?.offsets[voice] ?? 0), sampleRate);

/** What one event plays: a voice per pitch of its chord (one for unpitched sounds). */
function synthesizeEvent(instrument: Instrument, event: NoteEvent, seed: number, sampleRate: number, samples: SampleSource): Voice[] {
  return voicePitches(event).map((pitch, voice) => {
    const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
    return {
      start: voiceStart(event, voice, sampleRate),
      samples: instrument.synthesize({
        midi,
        frequency: midi === undefined ? undefined : midiToFrequency(midi + instrument.descriptor.transpose + event.detune / 100),
        velocity: event.vel * (event.strum?.weights[voice] ?? 1),
        hold: event.hold,
        variant: event.variant,
        sampleRate,
        rng: streamRng(seed, "note", event.track, event.note, event.repeat, voice),
        chordVoice: voice,
        samples,
      }),
    };
  });
}

/**
 * Where each voice of an instrument with a damper is cut, by `${event index}/${voice}`: the next
 * onset of the same key on the same track, by actual onset (a strum can move a chord's voice past
 * a later event's), and how many samples its fade takes. Voices that are never struck again are
 * absent.
 */
function damperCuts(events: readonly NoteEvent[], instruments: InstrumentTable, sampleRate: number): Map<string, { at: number; fade: number }> {
  const byKey = new Map<string, { id: string; start: number; fade: number }[]>();
  events.forEach((event, index) => {
    const damper = instruments.get(event.instrument)?.descriptor.damper;
    if (damper === undefined) return;
    voicePitches(event).forEach((pitch, voice) => {
      const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
      if (midi === undefined) return;
      const key = `${event.track}/${event.instrument}/${midi}`;
      const fade = Math.max(1, secondsToSample(damper.seconds, sampleRate));
      byKey.set(key, [...(byKey.get(key) ?? []), { id: `${index}/${voice}`, start: voiceStart(event, voice, sampleRate), fade }]);
    });
  });
  const cuts = new Map<string, { at: number; fade: number }>();
  for (const strikes of byKey.values()) {
    // Stable: strikes at the same sample keep score order, and the earlier is cut by the later.
    const ordered = [...strikes].sort((a, b) => a.start - b.start);
    ordered.forEach((strike, k) => {
      const next = ordered[k + 1];
      if (next !== undefined) cuts.set(strike.id, { at: next.start, fade: strike.fade });
    });
  }
  return cuts;
}

/** Fade a voice out over `fade` samples from sample `at` (absolute), silent after it. */
function damp(voice: Voice, at: number, fade: number): void {
  const from = Math.max(0, at - voice.start);
  for (let i = from; i < voice.samples.length; i++) {
    const k = i - from;
    voice.samples[i] = k < fade ? (voice.samples[i] ?? 0) * (1 - k / fade) : 0;
  }
}

function mixEvent(voices: Voice[], event: NoteEvent, mix: [Float32Array, Float32Array]): void {
  const gain = dmath.dbToGain(event.gainDb);
  const [left, right] = panGains(event.pan).map((g) => g * gain);
  for (const { start, samples } of voices) {
    const end = Math.min(mix[0].length, start + samples.length);
    for (let i = Math.max(0, start); i < end; i++) {
      const s = samples[i - start] ?? 0;
      mix[0][i] = (mix[0][i] ?? 0) + s * (left ?? 0);
      mix[1][i] = (mix[1][i] ?? 0) + s * (right ?? 0);
    }
  }
}

/** The score's events, or a JingleScriptError listing what keeps it from rendering. */
export function expandOrThrow(score: Score): ReturnType<typeof expandScore> {
  const expanded = expandScore(score);
  if (expanded.issues.length > 0) {
    throw new JingleScriptError(
      expanded.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message, ...(issue.hint ? { hint: issue.hint } : {}) })),
    );
  }
  return expanded;
}

/**
 * The recorded samples a render of `score` would read (keys for SampleSource.get), found by
 * synthesizing the notes of sampled instruments (built-in, or custom ones built on them) against
 * silence. Empty, and nothing synthesized, when the score plays no sampled instrument.
 */
export function samplesNeeded(score: Score, options: Pick<RenderOptions, "seed"> = {}): string[] {
  const expanded = expandOrThrow(score);
  const recorder = recordingSource();
  for (const event of expanded.events) {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument?.descriptor.sampled !== undefined) synthesizeEvent(instrument, event, options.seed ?? score.seed, DEFAULT_SAMPLE_RATE, recorder);
  }
  return [...recorder.keys].sort((a, b) => a.localeCompare(b));
}

export function render(score: Score, options: RenderOptions = {}): RenderResult {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const seed = options.seed ?? score.seed;
  const expanded = expandOrThrow(score);
  const length = secondsToSample(expanded.duration, sampleRate);
  const wet: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const dry: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const cuts = damperCuts(expanded.events, expanded.instruments, sampleRate);
  expanded.events.forEach((event, index) => {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument === undefined) return;
    const voices = synthesizeEvent(instrument, event, seed, sampleRate, options.samples ?? NO_SAMPLES);
    voices.forEach((voice, k) => {
      const cut = cuts.get(`${index}/${k}`);
      if (cut !== undefined) damp(voice, cut.at, cut.fade);
    });
    mixEvent(voices, event, score.tracks[event.track]?.reverb === false ? dry : wet);
  });
  const { audio, stats } = master(wet, dry, {
    sampleRate,
    seed,
    reverb: score.master.reverb,
    fadeOut: score.master.fadeOut,
    loudness: score.master.loudness,
    limiter: score.master.limiter,
  });
  const timing = buildTiming(expanded, measureAudibleUntil(audio, sampleRate));
  return { audio, sampleRate, timing, stats };
}
