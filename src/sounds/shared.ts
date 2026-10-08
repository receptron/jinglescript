// Building blocks for sound effects: pitch-dropping sines, shaped noise, variant choice. All
// randomness comes from the note's seeded stream.
import { biquadFilter, type Biquad } from "../dsp/biquad.ts";
import type { Rng } from "../rng.ts";

/** The named variant, or the first (the default). */
export function pickVariant<T extends string>(variants: readonly [T, ...T[]], name: string | undefined): T {
  return variants.find((v) => v === name) ?? variants[0];
}

export interface Glide {
  /** Starting frequency, Hz. */
  from: number;
  /** Frequency it settles to, Hz. */
  to: number;
  /** Time constant of the glide, seconds. */
  glide: number;
  /** Time constant of the amplitude decay, seconds. */
  decay: number;
  level: number;
  /** Start, seconds. */
  at?: number;
}

/** A sine whose pitch falls exponentially from `from` to `to` while it decays (thumps, booms, pops). */
export function addGlide(out: Float32Array, g: Glide, sampleRate: number): void {
  const start = Math.round((g.at ?? 0) * sampleRate);
  let phase = 0;
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / sampleRate;
    const f = g.to + (g.from - g.to) * Math.exp(-t / g.glide);
    out[i] = (out[i] ?? 0) + g.level * Math.exp(-t / g.decay) * Math.sin(phase);
    phase += (2 * Math.PI * f) / sampleRate;
  }
}

export interface NoiseShape {
  /** Start, seconds. */
  at?: number;
  /** Time constant of its decay, seconds. */
  decay: number;
  level: number;
  /** Filters applied in series. */
  filters: readonly Biquad[];
}

/** Gaussian noise with an exponential decay, filtered, added into `out`. */
export function addNoise(out: Float32Array, shape: NoiseShape, rng: Rng, sampleRate: number): void {
  const start = Math.round((shape.at ?? 0) * sampleRate);
  const n = out.length - start;
  if (n <= 0) return;
  let x: Float64Array = Float64Array.from({ length: n }, (_, i) => rng.normal() * Math.exp(-i / sampleRate / shape.decay));
  for (const filter of shape.filters) x = biquadFilter(x, filter);
  for (let i = 0; i < n; i++) out[start + i] = (out[start + i] ?? 0) + shape.level * (x[i] ?? 0);
}

/** A value scaled by a seeded factor in [1 − amount, 1 + amount]. */
export function vary(value: number, amount: number, rng: Rng): number {
  return value * (1 + (rng.next() * 2 - 1) * amount);
}
