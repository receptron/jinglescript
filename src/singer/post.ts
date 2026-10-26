// The singer's optional post-processing chain (docs/singing-voice-plan.md §5). Ideas only from
// APAZZI's APATT (closed source; no code, coefficients or presets used): every stage is a textbook
// formula or a public standard (RBJ Audio EQ Cookbook, ITU-R BS.1770), built on src/dsp. Only
// +−×÷, sqrt and src/dsp/math.ts, so the same input gives bit-identical output.
import { biquadFilter, highpass, highShelf, type Biquad } from "../dsp/biquad.ts";
import { fft } from "../dsp/fft.ts";
import { limit } from "../dsp/limiter.ts";
import { integratedLoudness, kWeighting, truePeak } from "../dsp/loudness.ts";
import * as dmath from "../dsp/math.ts";

export interface VocalChainOptions {
  /** 1. Ride: short-term K-weighted level towards `rideTargetDb` (dBFS RMS). false to skip. */
  ride?: false | { targetDb?: number; maxBoostDb?: number; maxCutDb?: number };
  /** Per-hop voicing (1 = voiced); unvoiced hops get no ride boost. `hop` samples per entry. */
  voicing?: { voiced: Uint8Array; hop: number };
  /** Median F0 of the vocal (Hz). The resonance finder ignores its harmonics, which a held vowel makes look like resonances. */
  f0Hz?: number;
  /** 2. EQ: low cut, one automatic resonance notch, air shelf. false to skip. */
  eq?: false | { lowCutHz?: number; maxNotchDb?: number; airDb?: number };
  /** 3. Upward compression of quiet detail, gated above the noise floor. false to skip. */
  upward?: false | { thresholdDb?: number; ratio?: number; maxBoostDb?: number };
  /** 5–6. Only for a vocal rendered on its own (the jingle master does these otherwise). */
  standalone?: { ceilingDbtp?: number; targetLufs?: number };
}

export interface VocalChainStats {
  ride: { maxBoostDb: number; maxCutDb: number } | undefined;
  notch: { hz: number; cutDb: number } | undefined;
  upward: { maxBoostDb: number } | undefined;
  limiterDb: number | undefined;
  loudness: number;
  truePeak: number;
}

const BLOCK = 512;

/** RBJ peaking EQ (cookbook). */
export function peaking(frequency: number, gainDb: number, q: number, sampleRate: number): Biquad {
  const A = dmath.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = dmath.sin(w0) / (2 * q);
  const cos = dmath.cos(w0);
  const a0 = 1 + alpha / A;
  return { b: [(1 + alpha * A) / a0, (-2 * cos) / a0, (1 - alpha * A) / a0], a: [1, (-2 * cos) / a0, (1 - alpha / A) / a0] };
}

/** Level per block of BLOCK samples, dB, of the K-weighted signal (mean square). */
function blockLevels(x: Float32Array, sampleRate: number): Float64Array {
  const k = kWeighting(sampleRate);
  const weighted = biquadFilter(biquadFilter(x, k.shelf), k.highpass);
  const levels = new Float64Array(Math.ceil(x.length / BLOCK));
  for (let b = 0; b < levels.length; b++) {
    let sum = 0;
    const end = Math.min(x.length, (b + 1) * BLOCK);
    for (let i = b * BLOCK; i < end; i++) sum += (weighted[i] ?? 0) * (weighted[i] ?? 0);
    levels[b] = 10 * dmath.log10(sum / Math.max(1, end - b * BLOCK) + 1e-12);
  }
  return levels;
}

/** Noise floor: the 10th-percentile block level, at least -70 dB. */
function noiseFloor(levels: Float64Array): number {
  const sorted = [...levels].sort((a, b) => a - b);
  return Math.max(-70, sorted[Math.floor(sorted.length * 0.1)] ?? -70);
}

/** One-pole smoothing of per-block gains (dB), faster down than up, then per-sample application. */
function applyBlockGains(x: Float32Array, gains: Float64Array): void {
  const smooth = new Float64Array(gains.length);
  let g = gains[0] ?? 0;
  for (let b = 0; b < gains.length; b++) {
    const want = gains[b] ?? 0;
    g += (want - g) * (want < g ? 0.5 : 0.15);
    smooth[b] = g;
  }
  for (let i = 0; i < x.length; i++) {
    const b = Math.floor(i / BLOCK);
    const t = (i - b * BLOCK) / BLOCK;
    const a = smooth[b] ?? 0;
    const db = a + ((smooth[b + 1] ?? a) - a) * t;
    x[i] = (x[i] ?? 0) * dmath.dbToGain(db);
  }
}

function isVoicedAt(block: number, voicing: VocalChainOptions["voicing"]): boolean {
  if (voicing === undefined) return true;
  return (voicing.voiced[Math.floor((block * BLOCK + BLOCK / 2) / voicing.hop)] ?? 0) === 1;
}

/** 1. Ride: gains towards the target, boost capped, none below the floor or on unvoiced hops. */
function ride(x: Float32Array, sampleRate: number, options: Exclude<VocalChainOptions["ride"], false> = {}, voicing?: VocalChainOptions["voicing"]) {
  const target = options.targetDb ?? -20;
  const maxBoost = options.maxBoostDb ?? 6;
  const maxCut = options.maxCutDb ?? 9;
  const levels = blockLevels(x, sampleRate);
  const floor = noiseFloor(levels) + 6;
  const gains = levels.map((level, b) => {
    const boost = level < floor || !isVoicedAt(b, voicing) ? 0 : maxBoost;
    return Math.max(-maxCut, Math.min(boost, target - level));
  });
  applyBlockGains(x, gains);
  return { maxBoostDb: Math.max(0, ...gains), maxCutDb: Math.max(0, ...gains.map((g) => -g)) };
}

/** Average magnitude spectrum (dB) over Hann frames of 4096. */
function averageSpectrum(x: Float32Array): Float64Array {
  const n = 4096;
  const sum = new Float64Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let frames = 0;
  for (let start = 0; start + n <= x.length; start += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * dmath.cos((2 * Math.PI * i) / n));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) sum[k] = (sum[k] ?? 0) + (re[k] ?? 0) * (re[k] ?? 0) + (im[k] ?? 0) * (im[k] ?? 0);
    frames++;
  }
  return sum.map((p) => 10 * dmath.log10(p / Math.max(1, frames) + 1e-20));
}

/** Whether a frequency is within 4% (and at least two FFT bins) of a harmonic of f0. */
function nearHarmonic(hz: number, f0: number, binHz: number): boolean {
  const n = Math.max(1, Math.round(hz / f0));
  return Math.abs(hz - n * f0) <= Math.max(2 * binHz, 0.04 * n * f0);
}

/**
 * The most prominent narrow peak 200 Hz–8 kHz above its ±1/3-octave neighbourhood, if > 6 dB.
 * With `f0Hz`, peaks near its harmonics are not resonances and are skipped.
 */
export function findResonance(x: Float32Array, sampleRate: number, f0Hz?: number): { hz: number; excessDb: number } | undefined {
  const spectrum = averageSpectrum(x);
  const binHz = sampleRate / 4096;
  let best: { hz: number; excessDb: number } | undefined;
  for (let k = Math.ceil(200 / binHz); k < Math.min(spectrum.length, 8000 / binHz); k++) {
    const lo = Math.max(1, Math.floor(k * 0.79));
    const hi = Math.min(spectrum.length - 1, Math.ceil(k * 1.26));
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += spectrum[j] ?? 0;
    const excess = (spectrum[k] ?? 0) - sum / (hi - lo + 1);
    if (f0Hz !== undefined && f0Hz > 0 && nearHarmonic(k * binHz, f0Hz, binHz)) continue;
    if (excess > 6 && (best === undefined || excess > best.excessDb)) best = { hz: k * binHz, excessDb: excess };
  }
  return best;
}

/** 2. EQ, in place. */
function equalize(x: Float32Array, sampleRate: number, options: Exclude<VocalChainOptions["eq"], false> = {}, f0Hz?: number) {
  const filters: Biquad[] = [highpass(options.lowCutHz ?? 90, Math.SQRT1_2, sampleRate)];
  const resonance = findResonance(x, sampleRate, f0Hz);
  const notch = resonance && { hz: resonance.hz, cutDb: Math.min(options.maxNotchDb ?? 6, resonance.excessDb / 2) };
  if (notch) filters.push(peaking(notch.hz, -notch.cutDb, 8, sampleRate));
  if ((options.airDb ?? 2) !== 0) filters.push(highShelf(10000, options.airDb ?? 2, sampleRate));
  let y: ArrayLike<number> = x;
  for (const filter of filters) y = biquadFilter(y, filter);
  x.set(y);
  return notch;
}

/** 3. Upward compression below the threshold, never below the noise floor. */
function upward(x: Float32Array, sampleRate: number, options: Exclude<VocalChainOptions["upward"], false> = {}) {
  const threshold = options.thresholdDb ?? -35;
  const ratio = options.ratio ?? 2;
  const maxBoost = options.maxBoostDb ?? 6;
  const levels = blockLevels(x, sampleRate);
  const floor = noiseFloor(levels) + 6;
  const gains = levels.map((level) => (level < floor || level >= threshold ? 0 : Math.min(maxBoost, (threshold - level) * (1 - 1 / ratio))));
  applyBlockGains(x, gains);
  return { maxBoostDb: Math.max(0, ...gains) };
}

/** 4. M/S width for a stereo vocal (after reverb): side low-cut at 200 Hz, width capped at 1.5. */
export function msWidth(left: Float32Array, right: Float32Array, width: number, sampleRate: number): void {
  const w = Math.max(0, Math.min(1.5, width));
  const side = new Float64Array(left.length);
  for (let i = 0; i < left.length; i++) side[i] = ((left[i] ?? 0) - (right[i] ?? 0)) / 2;
  const cut = biquadFilter(side, highpass(200, Math.SQRT1_2, sampleRate));
  for (let i = 0; i < left.length; i++) {
    const mid = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
    left[i] = mid + (cut[i] ?? 0) * w;
    right[i] = mid - (cut[i] ?? 0) * w;
  }
}

/** 5–6. True-peak-safe limiting and LUFS normalisation that only ever turns down. */
function finish(x: Float32Array, sampleRate: number, options: NonNullable<VocalChainOptions["standalone"]>): number {
  const loudness = integratedLoudness([x], sampleRate);
  const cut = Math.min(0, (options.targetLufs ?? -16) - loudness);
  if (Number.isFinite(cut)) for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * dmath.dbToGain(cut);
  const pair: [Float32Array, Float32Array] = [x, x.slice()];
  // Sample-peak ceiling 0.5 dB under the dBTP target leaves room for inter-sample peaks.
  const reduction = limit(pair, dmath.dbToGain((options.ceilingDbtp ?? -1) - 0.5), sampleRate);
  x.set(pair[0]);
  return reduction;
}

/** Runs stages 1–3 (and 5–6 when `standalone`) on a mono vocal; returns a new buffer and what each stage did. */
export function vocalChain(input: Float32Array, sampleRate: number, options: VocalChainOptions = {}): { pcm: Float32Array; stats: VocalChainStats } {
  const x = input.slice();
  const rideStats = options.ride === false ? undefined : ride(x, sampleRate, options.ride, options.voicing);
  const notch = options.eq === false ? undefined : equalize(x, sampleRate, options.eq, options.f0Hz);
  const upwardStats = options.upward === false ? undefined : upward(x, sampleRate, options.upward);
  const limiterDb = options.standalone ? finish(x, sampleRate, options.standalone) : undefined;
  return {
    pcm: x,
    stats: { ride: rideStats, notch, upward: upwardStats, limiterDb, loudness: integratedLoudness([x], sampleRate), truePeak: truePeak([x]) },
  };
}
