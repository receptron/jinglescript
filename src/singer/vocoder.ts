// The built-in DSP vocoder for singer models without a neural one (the S1 placeholder): harmonics
// of F0 for voiced frames plus shaped noise, both read from a per-frame band log-power envelope.
// It inverts the analysis in training/singing/tiny_placeholder.py: a band's mean power per FFT bin
// P (Hann window, normalised by Σw²) is a harmonic amplitude √(4·F0·P/sr) or a noise density P.
// Only +−×÷, sqrt and src/dsp/math.ts; noise from the seeded PRNG, so the output is deterministic.
import { fft } from "../dsp/fft.ts";
import * as dmath from "../dsp/math.ts";
import type { Rng } from "../rng.ts";

export interface EnvelopeFormat {
  sampleRate: number;
  hopSize: number;
  bands: number;
  fftSize: number;
  maxHz: number;
}

/** Breath noise kept under voiced frames, relative to the envelope. */
const VOICED_NOISE = 0.08;

function bandValue(env: Float32Array, frame: number, bands: number, hz: number, maxHz: number): number {
  const position = (hz / maxHz) * bands - 0.5;
  const b = Math.max(0, Math.min(bands - 1, Math.floor(position)));
  const next = Math.min(bands - 1, b + 1);
  const t = Math.max(0, Math.min(1, position - b));
  const a = env[frame * bands + b] ?? -23;
  return a + ((env[frame * bands + next] ?? -23) - a) * t;
}

/** Harmonic amplitudes of one frame (0 when unvoiced). */
function harmonicAmps(env: Float32Array, f0: Float32Array, frame: number, format: EnvelopeFormat, limit: number): Float64Array {
  const a = new Float64Array(MAX_HARMONICS);
  const hz = f0[frame] ?? 0;
  if (frame >= f0.length || hz <= 0) return a;
  for (let k = 1; k <= MAX_HARMONICS && k * hz < limit; k++) {
    a[k - 1] = Math.sqrt((4 * hz * dmath.exp(bandValue(env, frame, format.bands, k * hz, format.maxHz))) / format.sampleRate);
  }
  return a;
}

const MAX_HARMONICS = 256;

/** Sum of harmonics at phase θ, amplitudes interpolated by t; sin(kθ) by the Chebyshev recurrence. */
function harmonicSample(phase: number, hz: number, from: Float64Array, to: Float64Array, t: number, limit: number): number {
  const c2 = 2 * dmath.cos(phase);
  let previous = 0;
  let current = dmath.sin(phase);
  let sum = 0;
  for (let k = 0; k < MAX_HARMONICS && (k + 1) * hz < limit; k++) {
    const a = (from[k] ?? 0) + ((to[k] ?? 0) - (from[k] ?? 0)) * t;
    sum += a * current;
    const next = c2 * current - previous;
    previous = current;
    current = next;
  }
  return sum;
}

function addHarmonics(out: Float32Array, env: Float32Array, f0: Float32Array, format: EnvelopeFormat, limit: number): void {
  const { sampleRate: sr, hopSize: hop } = format;
  let phase = 0;
  for (let frame = 0; frame < f0.length; frame++) {
    const here = f0[frame] ?? 0;
    const there = f0[frame + 1] ?? here;
    if (here <= 0 && there <= 0) continue;
    const from = harmonicAmps(env, f0, frame, format, limit);
    const to = harmonicAmps(env, f0, frame + 1, format, limit);
    const hzA = here > 0 ? here : there;
    const hzB = there > 0 ? there : here;
    for (let i = 0; i < hop; i++) {
      const t = i / hop;
      const hz = hzA + (hzB - hzA) * t;
      phase += (2 * Math.PI * hz) / sr;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      const at = frame * hop + i;
      out[at] = (out[at] ?? 0) + harmonicSample(phase, hz, from, to, t, limit);
    }
  }
}

/** One frame of white noise shaped to the envelope (in place, time domain after return). */
function shapedNoise(
  buffer: { re: Float64Array; im: Float64Array },
  env: Float32Array,
  frame: number,
  level: number,
  format: EnvelopeFormat & { limit: number },
  rng: Rng,
): void {
  const { re, im } = buffer;
  const { limit } = format;
  const n = format.fftSize;
  for (let i = 0; i < n; i++) {
    re[i] = rng.normal();
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) {
    const hz = (k * format.sampleRate) / n;
    const scale = hz >= limit ? 0 : level * Math.sqrt(dmath.exp(bandValue(env, frame, format.bands, hz, format.maxHz)));
    re[k] = (re[k] ?? 0) * scale;
    im[k] = (im[k] ?? 0) * scale;
    if (k > 0 && k < n / 2) {
      re[n - k] = re[k] ?? 0;
      im[n - k] = -(im[k] ?? 0);
    }
  }
  fft(re, im, true);
}

// Overlap-add with a Hann window; 4× overlap gives Σw² = 1.5 per sample.
function addNoise(out: Float32Array, env: Float32Array, f0: Float32Array, format: EnvelopeFormat, limit: number, rng: Rng): void {
  const { hopSize: hop, fftSize: n } = format;
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * dmath.cos((2 * Math.PI * i) / n);
  const gain = 1 / Math.sqrt((1.5 * n) / hop / 4);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let frame = 0; frame < f0.length; frame++) {
    shapedNoise({ re, im }, env, frame, (f0[frame] ?? 0) > 0 ? VOICED_NOISE : 1, { ...format, limit }, rng);
    const start = frame * hop - n / 2 + hop / 2;
    for (let i = Math.max(0, -start); i < n && start + i < out.length; i++) {
      out[start + i] = (out[start + i] ?? 0) + (re[i] ?? 0) * (window[i] ?? 0) * gain;
    }
  }
}

/** PCM (mono, `format.sampleRate`) from band log-power frames and per-frame F0 (Hz, 0 = unvoiced). */
export function synthesizeEnvelope(env: Float32Array, f0: Float32Array, format: EnvelopeFormat, rng: Rng): Float32Array {
  const out = new Float32Array(f0.length * format.hopSize + format.fftSize);
  const limit = Math.min(format.maxHz, format.sampleRate / 2 - 200);
  addHarmonics(out, env, f0, format, limit);
  addNoise(out, env, f0, format, limit, rng);
  return out.subarray(0, f0.length * format.hopSize);
}
