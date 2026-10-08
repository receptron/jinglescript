// Master chain after the tracks are summed: reverb → fade-out → loudness normalisation with a
// true-peak ceiling. Struck sounds and effects are far peakier than their loudness, so reaching the
// target usually needs a few dB of peak limiting; the limiter does that, up to MAX_LIMITING_DB,
// and beyond that the loudness is left short of the target rather than squashing the hit.
import { limit } from "./limiter.ts";
import { integratedLoudness, truePeak } from "./loudness.ts";
import { applyReverb, type Reverb } from "./reverb.ts";
import * as dmath from "./math.ts";

export const TRUE_PEAK_CEILING = -1.5;
/** The most gain reduction the limiter may apply, dB. */
export const MAX_LIMITING_DB = 6;
/** The limiter works on samples; aim this far under the true-peak ceiling for inter-sample peaks. */
const SAMPLE_PEAK_MARGIN_DB = 0.3;
/** −40 dBFS: below this for good, the jingle has ended (`audibleUntil`). */
export const AUDIBLE_THRESHOLD = dmath.dbToGain(-40);

export interface MasterOptions {
  sampleRate: number;
  seed: number;
  reverb: Reverb;
  fadeOut: number;
  /** Target integrated loudness, LUFS. */
  loudness: number;
  /** Allow peak limiting to reach the loudness target. */
  limiter: boolean;
}

export interface MasterStats {
  /** Integrated loudness of the output, LUFS. */
  loudness: number;
  /** True peak of the output, dBTP. */
  truePeak: number;
  /** Gain applied to reach the target, dB. */
  gainDb: number;
  /** Largest gain reduction the limiter applied, dB (0 = untouched). */
  limitingDb: number;
  /** True when the true-peak ceiling (and the limiter's maximum) kept the loudness below the target. */
  limitedByPeak: boolean;
}

function fadeOut(channels: [Float32Array, Float32Array], seconds: number, sampleRate: number): void {
  const n = Math.min(channels[0].length, Math.round(seconds * sampleRate));
  if (n <= 0) return;
  const start = channels[0].length - n;
  for (const channel of channels) {
    for (let i = 0; i < n; i++) channel[start + i] = (channel[start + i] ?? 0) * (1 - (i + 1) / n);
  }
}

function scale(channels: [Float32Array, Float32Array], gain: number): void {
  for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
}

const dbToGain = dmath.dbToGain;
const samplePeak = (channels: readonly Float32Array[]): number => Math.max(...channels.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

/** `source` scaled by `gainDb`, then limited if allowed; returns the result and the limiting applied. */
function gainAndLimit(
  source: [Float32Array, Float32Array],
  gainDb: number,
  options: MasterOptions,
): { audio: [Float32Array, Float32Array]; limitingDb: number } {
  const audio: [Float32Array, Float32Array] = [Float32Array.from(source[0]), Float32Array.from(source[1])];
  scale(audio, dbToGain(gainDb));
  if (!options.limiter) return { audio, limitingDb: 0 };
  return { audio, limitingDb: limit(audio, dbToGain(TRUE_PEAK_CEILING - SAMPLE_PEAK_MARGIN_DB), options.sampleRate) };
}

/**
 * `wet` goes through the reverb; `dry` (tracks with `"reverb": false`) joins after it. Both then
 * share the fade and the loudness stage.
 */
export function master(
  wet: [Float32Array, Float32Array],
  dry: [Float32Array, Float32Array],
  options: MasterOptions,
): { audio: [Float32Array, Float32Array]; stats: MasterStats } {
  const faded = applyReverb(wet, options.reverb, options.sampleRate, options.seed);
  for (let c = 0; c < 2; c++) {
    const target = faded[c];
    const source = dry[c];
    if (target && source) for (let i = 0; i < target.length; i++) target[i] = (target[i] ?? 0) + (source[i] ?? 0);
  }
  fadeOut(faded, options.fadeOut, options.sampleRate);
  const measured = integratedLoudness(faded, options.sampleRate);
  if (!Number.isFinite(measured)) {
    return { audio: faded, stats: { loudness: measured, truePeak: truePeak(faded), gainDb: 0, limitingDb: 0, limitedByPeak: false } };
  }
  // Without a limiter the true peak caps the gain. With it, the gain may push the sample peak up to
  // MAX_LIMITING_DB over the ceiling; limiting lowers the loudness a little, so correct once.
  const peakDb = 20 * dmath.log10(samplePeak(faded));
  const headroom = TRUE_PEAK_CEILING - SAMPLE_PEAK_MARGIN_DB - peakDb + (options.limiter ? MAX_LIMITING_DB : 0);
  let gainDb = Math.min(options.loudness - measured, headroom);
  let pass = gainAndLimit(faded, gainDb, options);
  if (pass.limitingDb > 0) {
    const shortfall = options.loudness - integratedLoudness(pass.audio, options.sampleRate);
    gainDb = Math.min(gainDb + shortfall, headroom);
    pass = gainAndLimit(faded, gainDb, options);
  }
  // Final guard on inter-sample peaks the sample-domain limiter cannot see.
  // Aim a hair under the ceiling so float rounding cannot land on the wrong side of it.
  const excess = truePeak(pass.audio) - (TRUE_PEAK_CEILING - 0.01);
  if (excess > 0) {
    scale(pass.audio, dbToGain(-excess));
    gainDb -= excess;
  }
  const loudness = integratedLoudness(pass.audio, options.sampleRate);
  return {
    audio: pass.audio,
    stats: { loudness, truePeak: truePeak(pass.audio), gainDb, limitingDb: pass.limitingDb, limitedByPeak: loudness < options.loudness - 0.5 },
  };
}

/** Seconds until the audio last reaches −40 dBFS. */
export function measureAudibleUntil(audio: readonly Float32Array[], sampleRate: number): number {
  const length = audio[0]?.length ?? 0;
  for (let i = length - 1; i >= 0; i--) {
    if (audio.some((channel) => Math.abs(channel[i] ?? 0) >= AUDIBLE_THRESHOLD)) return (i + 1) / sampleRate;
  }
  return 0;
}
