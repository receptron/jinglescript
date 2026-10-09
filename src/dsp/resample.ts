// Band-limited resampling for sampled instruments: reads a recording at any speed (a pitch shift
// and a sample-rate change in one step) through a Kaiser-windowed sinc, so nothing folds back
// below Nyquist. The kernel is tabulated at PHASES fractional positions and interpolated
// linearly between them; built from src/dsp/math.ts, it is the same on every machine.
import * as dmath from "./math.ts";

/** Input samples on each side of the read position. */
const HALF_TAPS = 64;
const TAPS = 2 * HALF_TAPS;
const PHASES = 256;
/** Kaiser β: stopband about −80 dB. */
const BETA = 8;
/** Transition band of the kernel, cycles per input sample (about (80 − 8) / (14.36 · TAPS)). */
export const TRANSITION = 0.04;

/** Modified Bessel function I0, by its power series. */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50 && term > 1e-17 * sum; k++) {
    term *= q / (k * k);
    sum += term;
  }
  return sum;
}

/** Row p holds the taps for a read position p/PHASES past an input sample; PHASES + 1 rows. */
function kernelTable(cutoff: number): Float64Array {
  const table = new Float64Array((PHASES + 1) * TAPS);
  const norm = besselI0(BETA);
  for (let p = 0; p <= PHASES; p++) {
    for (let j = 0; j < TAPS; j++) {
      const t = j - HALF_TAPS + 1 - p / PHASES;
      const r = t / HALF_TAPS;
      const window = r * r >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / norm;
      const sinc = t === 0 ? 2 * cutoff : dmath.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
      table[p * TAPS + j] = sinc * window;
    }
  }
  return table;
}

/**
 * `length` output samples read from `x` every `step` input samples (2 = an octave up at the same
 * rate), low-passed at `cutoff` cycles per input sample (at most 0.5 − TRANSITION / 2). Reads past
 * the end of `x` are silence.
 */
export function resample(x: Float32Array, step: number, cutoff: number, length: number): Float32Array {
  const table = kernelTable(Math.min(cutoff, 0.5 - TRANSITION / 2));
  const out = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    const position = n * step;
    const i = Math.floor(position);
    if (i - HALF_TAPS >= x.length) break;
    const phase = (position - i) * PHASES;
    const p = Math.floor(phase);
    const blend = phase - p;
    const row = p * TAPS;
    let sum = 0;
    for (let j = 0; j < TAPS; j++) {
      const k = i + j - HALF_TAPS + 1;
      if (k < 0 || k >= x.length) continue;
      const a = table[row + j] ?? 0;
      const b = table[row + TAPS + j] ?? 0;
      sum += (x[k] ?? 0) * (a + (b - a) * blend);
    }
    out[n] = sum;
  }
  return out;
}
