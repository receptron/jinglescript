// Radix-2 FFT and FFT convolution, for the reverb (a direct convolution with a 1 s impulse response
// would take minutes).
import * as dmath from "./math.ts";

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

function bitReverse(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
}

/** One butterfly stage over blocks of `size`. */
function stage(re: Float64Array, im: Float64Array, size: number, inverse: boolean): void {
  const angle = ((inverse ? 2 : -2) * Math.PI) / size;
  const wRe = dmath.cos(angle);
  const wIm = dmath.sin(angle);
  const half = size / 2;
  for (let start = 0; start < re.length; start += size) {
    let curRe = 1;
    let curIm = 0;
    for (let k = 0; k < half; k++) {
      const a = start + k;
      const b = a + half;
      const bRe = (re[b] ?? 0) * curRe - (im[b] ?? 0) * curIm;
      const bIm = (re[b] ?? 0) * curIm + (im[b] ?? 0) * curRe;
      re[b] = (re[a] ?? 0) - bRe;
      im[b] = (im[a] ?? 0) - bIm;
      re[a] = (re[a] ?? 0) + bRe;
      im[a] = (im[a] ?? 0) + bIm;
      const nextRe = curRe * wRe - curIm * wIm;
      curIm = curRe * wIm + curIm * wRe;
      curRe = nextRe;
    }
  }
}

/** In-place iterative FFT (length a power of two); `inverse` also scales by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  bitReverse(re, im);
  for (let size = 2; size <= n; size *= 2) stage(re, im, size, inverse);
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

/** Linear convolution of `signal` with `kernel`, truncated to the signal's length. */
export function convolve(signal: Float32Array, kernel: Float64Array): Float32Array {
  const size = nextPowerOfTwo(signal.length + kernel.length - 1);
  const aRe = new Float64Array(size);
  const aIm = new Float64Array(size);
  const bRe = new Float64Array(size);
  const bIm = new Float64Array(size);
  aRe.set(signal);
  bRe.set(kernel);
  fft(aRe, aIm);
  fft(bRe, bIm);
  for (let i = 0; i < size; i++) {
    const re = (aRe[i] ?? 0) * (bRe[i] ?? 0) - (aIm[i] ?? 0) * (bIm[i] ?? 0);
    const im = (aRe[i] ?? 0) * (bIm[i] ?? 0) + (aIm[i] ?? 0) * (bRe[i] ?? 0);
    aRe[i] = re;
    aIm[i] = im;
  }
  fft(aRe, aIm, true);
  return Float32Array.from(aRe.subarray(0, signal.length));
}
