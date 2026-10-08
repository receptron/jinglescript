// Look-ahead peak limiter, offline: the gain starts falling `lookahead` before a peak so the peak is
// never exceeded, and recovers with an exponential release. Stereo-linked (both channels get the
// same gain, so the image does not shift). Deterministic: plain arithmetic, no state between calls.

const LOOKAHEAD_SECONDS = 0.002;
const RELEASE_SECONDS = 0.08;

/** Moving minimum of `x` over [i, i + window] (a monotonic deque). */
function forwardMin(x: Float64Array, window: number): Float64Array {
  const out = new Float64Array(x.length);
  const deque: number[] = [];
  let head = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    while (deque.length > head && (x[deque[deque.length - 1] ?? 0] ?? 1) >= (x[i] ?? 1)) deque.pop();
    deque.push(i);
    while ((deque[head] ?? 0) > i + window) head++;
    out[i] = x[deque[head] ?? i] ?? 1;
  }
  return out;
}

/**
 * Applies the limiter in place so no sample exceeds `ceiling` (linear). Returns the largest gain
 * reduction applied, in dB (0 when nothing was touched).
 */
export function limit(channels: [Float32Array, Float32Array], ceiling: number, sampleRate: number): number {
  const length = channels[0].length;
  const needed = new Float64Array(length);
  let touched = false;
  for (let i = 0; i < length; i++) {
    const peak = Math.max(Math.abs(channels[0][i] ?? 0), Math.abs(channels[1][i] ?? 0));
    needed[i] = peak > ceiling ? ceiling / peak : 1;
    if (peak > ceiling) touched = true;
  }
  if (!touched) return 0;

  const window = Math.max(1, Math.round(LOOKAHEAD_SECONDS * sampleRate));
  const held = forwardMin(needed, window);
  // Averaging the held curve over the look-ahead ramps the gain down smoothly and still reaches
  // each peak's value by the time the peak arrives (every term in its average is ≤ it).
  const release = 1 - Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  let running = 0;
  let gain = 1;
  let deepest = 1;
  for (let i = 0; i < length; i++) {
    running += held[i] ?? 1;
    if (i > window) running -= held[i - window - 1] ?? 1;
    const attack = running / Math.min(i + 1, window + 1);
    gain = Math.min(attack, gain + (1 - gain) * release);
    deepest = Math.min(deepest, gain);
    channels[0][i] = (channels[0][i] ?? 0) * gain;
    channels[1][i] = (channels[1][i] ?? 0) * gain;
  }
  return -20 * Math.log10(deepest);
}
