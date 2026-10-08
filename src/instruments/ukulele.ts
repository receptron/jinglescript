// Ukulele, from the prototype (instruments.py): a Karplus–Strong plucked string (loss 0.996).
// The prototype's delay line was a whole number of samples, which put notes up to ~14 cents
// out of tune (13.9 at C6); a first-order all-pass supplies the fractional part so every note is in tune. The
// excitation's DC is removed, and the prototype's cut at 2.2 s becomes a short damper fade.
import { buffer, finish } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

const LOSS = 0.996;
const RING_SECONDS = 2.2;
const DAMPER_SECONDS = 0.3;
/** +9.7 dB: loudness of a C5 at full velocity matched to the marimba's. */
const LEVEL = 10 ** (9.7 / 20);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const period = sampleRate / (input.frequency ?? 261.63);
  // Loop delay = line + 0.5 (the two-point average) + all-pass delay, kept in [0.1, 1.1).
  const line = Math.max(2, Math.floor(period - 0.6));
  const fraction = period - 0.5 - line;
  const c = (1 - fraction) / (1 + fraction);
  const delay = Float64Array.from({ length: line }, () => rng.next() * 2 - 1);
  // The loop passes DC almost unchanged, so the excitation's mean would sit in the output as an
  // offset for the whole note (it did in the prototype). Remove it.
  const mean = delay.reduce((sum, v) => sum + v, 0) / line;
  for (let i = 0; i < line; i++) delay[i] = (delay[i] ?? 0) - mean;
  const out = buffer(RING_SECONDS + DAMPER_SECONDS, sampleRate);
  let previous = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i % line;
    const y = delay[p] ?? 0;
    out[i] = y;
    const averaged = LOSS * 0.5 * (y + previous);
    previous = y;
    const shifted = c * averaged + apIn - c * apOut;
    apIn = averaged;
    apOut = shifted;
    delay[p] = shifted;
  }
  return finish(out, { attack: 0.001, endFade: DAMPER_SECONDS, gain: input.velocity * LEVEL }, sampleRate);
}

export const ukulele: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Plucked nylon string (ukulele / small guitar): light, sunny, acoustic. Strums, happy vlog and family-channel tunes.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C6" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
