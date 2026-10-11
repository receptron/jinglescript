// Score → stereo audio + timing map.
import { master, measureAudibleUntil, type MasterStats } from "./dsp/master.ts";
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
  /** The key it plays (undefined for unpitched sounds). */
  midi: number | undefined;
  samples: Float32Array;
}

/** What one event plays: a voice per pitch of its chord (one for unpitched sounds). */
function synthesizeEvent(instrument: Instrument, event: NoteEvent, seed: number, sampleRate: number, samples: SampleSource): Voice[] {
  const voices: (string | undefined)[] = event.pitches.length > 0 ? event.pitches : [undefined];
  return voices.map((pitch, voice) => {
    const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
    return {
      start: secondsToSample(event.seconds + (event.strum?.offsets[voice] ?? 0), sampleRate),
      midi,
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

/** A voice and where it goes: its bus and its left and right gains. */
interface Placed {
  voice: Voice;
  mix: [Float32Array, Float32Array];
  left: number;
  right: number;
}

function place(voices: Voice[], event: NoteEvent, mix: [Float32Array, Float32Array]): Placed[] {
  const gain = dmath.dbToGain(event.gainDb);
  const [left, right] = panGains(event.pan).map((g) => g * gain);
  return voices.map((voice) => ({ voice, mix, left: left ?? 0, right: right ?? 0 }));
}

function mixVoice({ voice: { start, samples }, mix, left, right }: Placed): void {
  const end = Math.min(mix[0].length, start + samples.length);
  for (let i = Math.max(0, start); i < end; i++) {
    const s = samples[i - start] ?? 0;
    mix[0][i] = (mix[0][i] ?? 0) + s * left;
    mix[1][i] = (mix[1][i] ?? 0) + s * right;
  }
}

/** Fade a voice out over `fade` samples from sample `at` (absolute), silent after it. */
function damp(voice: Voice, at: number, fade: number): void {
  const from = Math.max(0, at - voice.start);
  for (let i = from; i < voice.samples.length; i++) {
    const k = i - from;
    voice.samples[i] = k < fade ? (voice.samples[i] ?? 0) * (1 - k / fade) : 0;
  }
}

/**
 * Mixes voices; for an instrument with a damper, a key's voice is held back until the track
 * strikes that key again (which fades it out from the new onset) or the render ends. Only the
 * notes still ringing on each key are held, never the whole score.
 */
class Mixer {
  private readonly ringing = new Map<string, Placed>();

  add(placed: Placed[], event: NoteEvent, instrument: Instrument, sampleRate: number): void {
    const damper = instrument.descriptor.damper;
    for (const p of placed) {
      if (damper === undefined || p.voice.midi === undefined) {
        mixVoice(p);
        continue;
      }
      const key = `${event.track}/${event.instrument}/${p.voice.midi}`;
      const before = this.ringing.get(key);
      if (before !== undefined) {
        damp(before.voice, p.voice.start, Math.max(1, secondsToSample(damper.seconds, sampleRate)));
        mixVoice(before);
      }
      this.ringing.set(key, p);
    }
  }

  flush(): void {
    for (const p of this.ringing.values()) mixVoice(p);
    this.ringing.clear();
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
  const mixer = new Mixer();
  for (const event of expanded.events) {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument === undefined) continue;
    const voices = synthesizeEvent(instrument, event, seed, sampleRate, options.samples ?? NO_SAMPLES);
    mixer.add(place(voices, event, score.tracks[event.track]?.reverb === false ? dry : wet), event, instrument, sampleRate);
  }
  mixer.flush();
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
