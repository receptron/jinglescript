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
  samples: Float32Array;
}

/** What one event plays: a voice per pitch of its chord (one for unpitched sounds). */
function synthesizeEvent(instrument: Instrument, event: NoteEvent, seed: number, sampleRate: number, samples: SampleSource): Voice[] {
  const voices: (string | undefined)[] = event.pitches.length > 0 ? event.pitches : [undefined];
  return voices.map((pitch, voice) => {
    const midi = pitch === undefined ? undefined : pitchToMidi(pitch);
    return {
      start: secondsToSample(event.seconds + (event.strum?.offsets[voice] ?? 0), sampleRate),
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

function expandOrThrow(score: Score): ReturnType<typeof expandScore> {
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
  for (const event of expanded.events) {
    const instrument = expanded.instruments.get(event.instrument);
    if (instrument === undefined) continue;
    const voices = synthesizeEvent(instrument, event, seed, sampleRate, options.samples ?? NO_SAMPLES);
    mixEvent(voices, event, score.tracks[event.track]?.reverb === false ? dry : wet);
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
