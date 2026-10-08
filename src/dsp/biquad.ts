// Biquad filters (direct form I), shared by loudness measurement and the instruments.

export interface Biquad {
  b: [number, number, number];
  /** a[0] is 1 (coefficients are normalised). */
  a: [number, number, number];
}

export function biquadFilter(x: ArrayLike<number>, { b, a }: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] ?? 0;
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/** Band-pass with 0 dB peak gain at `frequency` (RBJ cookbook). */
export function bandpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b: [alpha / a0, 0, -alpha / a0], a: [1, (-2 * Math.cos(w0)) / a0, (1 - alpha) / a0] };
}

/** Low-pass (RBJ cookbook). */
export function lowpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b: [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0], a: [1, (-2 * cos) / a0, (1 - alpha) / a0] };
}

/** High-pass (RBJ cookbook). */
export function highpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b: [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0], a: [1, (-2 * cos) / a0, (1 - alpha) / a0] };
}

/** Band-pass whose centre moves over time (coefficients recomputed every `step` samples). */
export function sweptBandpass(x: ArrayLike<number>, centreAt: (t: number) => number, q: number, sampleRate: number, step = 32): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let coefficients = bandpass(centreAt(0), q, sampleRate);
  for (let i = 0; i < x.length; i++) {
    if (i % step === 0) coefficients = bandpass(Math.min(centreAt(i / sampleRate), sampleRate * 0.45), q, sampleRate);
    const { b, a } = coefficients;
    const x0 = x[i] ?? 0;
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}
