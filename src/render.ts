// Score → stereo audio + timing map.
import { master, measureAudibleUntil, type MasterStats } from "./dsp/master.ts";
import { expandScore, type Expanded, type NoteEvent, type PedalSpan } from "./events.ts";
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
  /**
   * Tracks already rendered elsewhere (the singer, which runs an ONNX model and so is async): mono
   * PCM at `sampleRate` from time 0, mixed in place of the track's own instrument, before mastering.
   */
  prerendered?: ReadonlyMap<number, Float32Array>;
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

/** Seconds two times may differ by and still count as the same. */
const EPSILON = 1e-9;

/** When a key released at `release` stops sounding: then, or when the pedal holding it lifts. */
function dampedAt(release: number, pedal: readonly PedalSpan[]): number {
  const held = pedal.find((span) => span.down <= release + EPSILON && release < span.up - EPSILON);
  return held === undefined ? release : held.up;
}

/**
 * Where each voice of an instrument with a damper is cut, by `${event index}/${voice}`, and over how
 * many samples it fades: at the next onset of the same key on the same track (by actual onset — a
 * strum can move a chord's voice past a later event's), or where its key is released (a written
 * `len`), held on by the track's pedal until it lifts, whichever is first. Voices never cut are
 * absent.
 */
function damperCuts(expanded: Expanded, sampleRate: number): Map<string, { at: number; fade: number }> {
  const byKey = new Map<string, { id: string; start: number; restrike: number }[]>();
  const cuts = new Map<string, { at: number; fade: number }>();
  expanded.events.forEach((event, index) => {
    const damper = expanded.instruments.get(event.instrument)?.descriptor.damper;
    if (damper === undefined) return;
    voicePitches(event).forEach((pitch, voice) => {
      // A strum spreads the onsets; each voice is held its full `len` from its own.
      const release = event.release === undefined ? undefined : event.release + (event.strum?.offsets[voice] ?? 0);
      const released = release === undefined ? undefined : dampedAt(release, expanded.pedals[event.track] ?? []);
      const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
      if (midi === undefined) return;
      const id = `${index}/${voice}`;
      const start = voiceStart(event, voice, sampleRate);
      const key = `${event.track}/${event.instrument}/${midi}`;
      byKey.set(key, [...(byKey.get(key) ?? []), { id, start, restrike: Math.max(1, secondsToSample(damper.restrike, sampleRate)) }]);
      if (released !== undefined) {
        cuts.set(id, { at: Math.max(start, secondsToSample(released, sampleRate)), fade: Math.max(1, secondsToSample(damper.release, sampleRate)) });
      }
    });
  });
  for (const strikes of byKey.values()) {
    // Stable: strikes at the same sample keep score order, and the earlier is cut by the later.
    const ordered = [...strikes].sort((x, y) => x.start - y.start);
    ordered.forEach((strike, k) => {
      const next = ordered[k + 1];
      const released = cuts.get(strike.id);
      if (next !== undefined && (released === undefined || next.start < released.at)) {
        cuts.set(strike.id, { at: next.start, fade: strike.restrike });
      }
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
  const cuts = damperCuts(expanded, sampleRate);
  expanded.events.forEach((event, index) => {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument === undefined || options.prerendered?.has(event.track)) return;
    const voices = synthesizeEvent(instrument, event, seed, sampleRate, options.samples ?? NO_SAMPLES);
    voices.forEach((voice, k) => {
      const cut = cuts.get(`${index}/${k}`);
      if (cut !== undefined) damp(voice, cut.at, cut.fade);
    });
    mixEvent(voices, event, score.tracks[event.track]?.reverb === false ? dry : wet);
  });
  for (const [track, pcm] of options.prerendered ?? []) {
    const bus = score.tracks[track]?.reverb === false ? dry : wet;
    const n = Math.min(length, pcm.length);
    for (let i = 0; i < n; i++) {
      bus[0][i] = (bus[0][i] ?? 0) + (pcm[i] ?? 0) * Math.SQRT1_2;
      bus[1][i] = (bus[1][i] ?? 0) + (pcm[i] ?? 0) * Math.SQRT1_2;
    }
  }
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
