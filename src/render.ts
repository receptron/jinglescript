// Score → stereo audio + timing map.
import { master, measureAudibleUntil, type MasterStats } from "./dsp/master.ts";
import { expandScore, type NoteEvent } from "./events.ts";
import type { Instrument } from "./instruments/index.ts";
import { midiToFrequency, pitchToMidi } from "./pitch.ts";
import { streamRng } from "./rng.ts";
import { formatPath, JingleScriptError, type Score } from "./score.ts";
import { secondsToSample } from "./time.ts";
import { buildTiming, type TimingMap } from "./timing.ts";
import * as dmath from "./dsp/math.ts";

export const DEFAULT_SAMPLE_RATE = 48000;
export const SAMPLE_RATES = [44100, 48000] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];

export interface RenderOptions {
  sampleRate?: SampleRate;
  /** Overrides the score's seed. */
  seed?: number;
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

function mixEvent(instrument: Instrument, event: NoteEvent, mix: [Float32Array, Float32Array], seed: number, sampleRate: number): void {
  const voices: (string | undefined)[] = event.pitches.length > 0 ? event.pitches : [undefined];
  const gain = dmath.dbToGain(event.gainDb);
  const [left, right] = panGains(event.pan).map((g) => g * gain);
  voices.forEach((pitch, voice) => {
    const start = secondsToSample(event.seconds + (event.strum?.offsets[voice] ?? 0), sampleRate);
    const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
    const samples = instrument.synthesize({
      midi,
      frequency: midi === undefined ? undefined : midiToFrequency(midi + instrument.descriptor.transpose + event.detune / 100),
      velocity: event.vel * (event.strum?.weights[voice] ?? 1),
      hold: event.hold,
      variant: event.variant,
      sampleRate,
      rng: streamRng(seed, "note", event.track, event.note, event.repeat, voice),
    });
    const end = Math.min(mix[0].length, start + samples.length);
    for (let i = Math.max(0, start); i < end; i++) {
      const s = samples[i - start] ?? 0;
      mix[0][i] = (mix[0][i] ?? 0) + s * (left ?? 0);
      mix[1][i] = (mix[1][i] ?? 0) + s * (right ?? 0);
    }
  });
}

export function render(score: Score, options: RenderOptions = {}): RenderResult {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const seed = options.seed ?? score.seed;
  const expanded = expandScore(score);
  if (expanded.issues.length > 0) {
    throw new JingleScriptError(
      expanded.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message, ...(issue.hint ? { hint: issue.hint } : {}) })),
    );
  }
  const length = secondsToSample(expanded.duration, sampleRate);
  const wet: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const dry: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (const event of expanded.events) {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument !== undefined) mixEvent(instrument, event, score.tracks[event.track]?.reverb === false ? dry : wet, seed, sampleRate);
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
