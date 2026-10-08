// Piano, from the prototype (instruments2.py): inharmonic partials k·f·√(1+B·k²) (B ≈ 0.0004),
// three slightly detuned strings per note (beating), a two-stage decay (fast then slow, faster
// for higher partials), hammer noise, 2 ms onset. Like the prototype it rings ~3 s whatever the
// note length; the prototype's hard cut at 3 s becomes a short damper fade.
import { addNoiseBurst, buffer, finish, partialAllowed } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

const B = 0.0004;
const PARTIALS = 11;
const STRINGS_HZ = [-0.6, 0, 0.7];
const RING_SECONDS = 3;
const DAMPER_SECONDS = 0.3;
/** +3.1 dB: loudness of a C5 at full velocity matched to the marimba's. */
const LEVEL = 10 ** (3.1 / 20);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate } = input;
  const f = input.frequency ?? 261.63;
  const out = buffer(RING_SECONDS + DAMPER_SECONDS, sampleRate);
  for (let k = 1; k <= PARTIALS; k++) {
    const fk = k * f * Math.sqrt(1 + B * k * k);
    if (!partialAllowed(fk, sampleRate)) break;
    const amp = (1 / k) ** 1.1 * (k === 2 ? 1.2 : 1);
    const fast = 0.35 / Math.sqrt(k);
    const slow = 2.5 / k ** 0.4;
    for (const detune of STRINGS_HZ) {
      const w = (2 * Math.PI * (fk + detune)) / sampleRate;
      for (let i = 0; i < out.length; i++) {
        const t = i / sampleRate;
        out[i] = (out[i] ?? 0) + (amp / 3) * (0.7 * Math.exp(-t / fast) + 0.3 * Math.exp(-t / slow)) * Math.sin(w * i);
      }
    }
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
