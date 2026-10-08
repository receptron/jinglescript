// Piano, from the prototype (instruments2.py): inharmonic partials k·f·√(1+B·k²) (B ≈ 0.0004),
// three slightly detuned strings per note (beating), a two-stage decay (fast then slow, faster
// for higher partials), hammer noise, 2 ms onset. Like the prototype it rings ~3 s whatever the
// note length; the prototype's hard cut at 3 s becomes a short damper fade.
import { addDampedSine, addNoiseBurst, buffer, finish, partialAllowed } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";
import * as dmath from "../dsp/math.ts";

const B = 0.0004;
const PARTIALS = 11;
const STRINGS_HZ = [-0.6, 0, 0.7];
const RING_SECONDS = 3;
const DAMPER_SECONDS = 0.3;
/** +3.1 dB: loudness of a C5 at full velocity matched to the marimba's. */
const LEVEL = dmath.dbToGain(3.1);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate } = input;
  const f = input.frequency ?? 261.63;
  const out = buffer(RING_SECONDS + DAMPER_SECONDS, sampleRate);
  for (let k = 1; k <= PARTIALS; k++) {
    const fk = k * f * Math.sqrt(1 + B * k * k);
    if (!partialAllowed(fk, sampleRate)) break;
    const amp = dmath.pow(1 / k, 1.1) * (k === 2 ? 1.2 : 1);
    // Two-stage decay, shared by the three strings: fast then slow, each a repeated multiply.
    const fast = dmath.exp(-1 / ((0.35 / Math.sqrt(k)) * sampleRate));
    const slow = dmath.exp(-1 / ((2.5 / dmath.pow(k, 0.4)) * sampleRate));
    const envelope = new Float64Array(out.length);
    let a = 0.7;
    let b = 0.3;
    for (let i = 0; i < out.length; i++, a *= fast, b *= slow) envelope[i] = a + b;
    for (const detune of STRINGS_HZ) addDampedSine(out, (2 * Math.PI * (fk + detune)) / sampleRate, amp / 3, Infinity, sampleRate, envelope);
  }
  addNoiseBurst(out, 0.005, 0.3, input.rng, sampleRate);
  return finish(out, { attack: 0.002, endFade: DAMPER_SECONDS, gain: input.velocity * LEVEL }, sampleRate);
}

export const piano: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Acoustic piano: full, warm, versatile. Chords and melodies for any style; rings about 3 s per note.",
    pitched: true,
    sustained: false,
    range: { low: "A0", high: "C8" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
