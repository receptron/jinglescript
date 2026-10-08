// ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms blocks with 75 % overlap, absolute and
// relative gating) and true peak (4× oversampling), for stereo at any sample rate.

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

/**
 * K-weighting filter coefficients for a sample rate: the two biquads of BS.1770 re-derived by the
 * bilinear transform (as libebur128 does), so 44.1 kHz gets its own filters. At 48 kHz they
 * reproduce the coefficients tabulated in the standard.
 */
export function kWeighting(sampleRate: number): { shelf: Biquad; highpass: Biquad } {
  const shelfF0 = 1681.974450955533;
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  let K = Math.tan((Math.PI * shelfF0) / sampleRate);
  const Vh = 10 ** (shelfGain / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / shelfQ + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / shelfQ + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / shelfQ + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / shelfQ + K * K) / a0],
  };
  const hpF0 = 38.13547087602444;
  const hpQ = 0.5003270373238773;
  K = Math.tan((Math.PI * hpF0) / sampleRate);
  const h0 = 1 + K / hpQ + K * K;
  const highpass: Biquad = {
    b: [1, -2, 1],
    a: [1, (2 * (K * K - 1)) / h0, (1 - K / hpQ + K * K) / h0],
  };
  return { shelf, highpass };
}

function filter(x: ArrayLike<number>, { b, a }: Biquad): Float64Array {
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

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/** Mean square of each gating block, summed over channels (all channel weights are 1 for stereo). */
function blockPowers(channels: readonly Float32Array[], sampleRate: number): number[] {
  const { shelf, highpass } = kWeighting(sampleRate);
  const length = channels[0]?.length ?? 0;
  const prefix = new Float64Array(length + 1);
  for (const channel of channels) {
    const weighted = filter(filter(channel, shelf), highpass);
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += (weighted[i] ?? 0) ** 2;
      prefix[i + 1] = (prefix[i + 1] ?? 0) + sum;
    }
  }
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  if (length < block) return length === 0 ? [] : [(prefix[length] ?? 0) / length];
  const powers: number[] = [];
  for (let start = 0; start + block <= length; start += step) {
    powers.push(((prefix[start + block] ?? 0) - (prefix[start] ?? 0)) / block);
  }
  return powers;
}

const toLufs = (power: number): number => -0.691 + 10 * Math.log10(power);
const mean = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

/** Integrated loudness in LUFS; -Infinity for silence. */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  const powers = blockPowers(channels, sampleRate).filter((p) => toLufs(p) > ABSOLUTE_GATE);
  if (powers.length === 0) return -Infinity;
  const relative = toLufs(mean(powers)) + RELATIVE_GATE;
  const gated = powers.filter((p) => toLufs(p) > relative);
  return toLufs(mean(gated));
}

const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12;

/** Polyphase interpolation filter: windowed sinc, cut off at the original Nyquist. */
function interpolationPhases(): Float64Array[] {
  const length = OVERSAMPLE * TAPS_PER_PHASE;
  const centre = (length - 1) / 2;
  const phases = Array.from({ length: OVERSAMPLE }, () => new Float64Array(TAPS_PER_PHASE));
  for (let n = 0; n < length; n++) {
    const x = (n - centre) / OVERSAMPLE;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length);
    const phase = phases[n % OVERSAMPLE];
    if (phase) phase[Math.floor(n / OVERSAMPLE)] = sinc * window;
  }
  return phases;
}

/** True peak in dBTP (4× oversampled), -Infinity for silence. */
export function truePeak(channels: readonly Float32Array[]): number {
  const phases = interpolationPhases();
  let peak = 0;
  for (const x of channels) {
    for (let i = 0; i < x.length; i++) {
      peak = Math.max(peak, Math.abs(x[i] ?? 0));
      for (const phase of phases) {
        let sum = 0;
        for (let k = 0; k < TAPS_PER_PHASE; k++) sum += (phase[k] ?? 0) * (x[i - k] ?? 0);
        peak = Math.max(peak, Math.abs(sum));
      }
    }
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}
