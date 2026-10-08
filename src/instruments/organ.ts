// Organ, from the prototype (instruments2.py): drawbar additive 16′ 8′ 4′ 2⅔′ 2′ 1⅓′, a 6.2 Hz
// rotary-ish wobble, a raw key click, ADSR held for the note's length.
import { addNoiseBurst, adsr, buffer, finish, partialAllowed } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

const DRAWBARS = [
  { ratio: 0.5, level: 0.5 },
  { ratio: 1, level: 1 },
  { ratio: 2, level: 0.7 },
  { ratio: 3, level: 0.45 },
  { ratio: 4, level: 0.35 },
  { ratio: 6, level: 0.15 },
];
const WOBBLE_HZ = 6.2;
const WOBBLE_DEPTH = 0.08;
const TAIL_SECONDS = 0.5;
/** The prototype's level (0.45), then -4.3 dB to match a C5 at full velocity to the marimba's loudness. */
const LEVEL = 0.45 * 10 ** (-4.3 / 20);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, hold } = input;
  const f = input.frequency ?? 261.63;
  const out = buffer(hold + TAIL_SECONDS, sampleRate);
  for (const bar of DRAWBARS) {
    if (!partialAllowed(f * bar.ratio, sampleRate)) continue;
    const w = (2 * Math.PI * f * bar.ratio) / sampleRate;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + bar.level * Math.sin(w * i);
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * (1 + WOBBLE_DEPTH * Math.sin((2 * Math.PI * WOBBLE_HZ * i) / sampleRate));
  addNoiseBurst(out, 0.003, 0.4, input.rng, sampleRate, false);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * adsr(i / sampleRate, 0.008, 0.05, 0.9, 0.06, hold);
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * LEVEL }, sampleRate);
}

export const organ: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Drawbar organ with a gentle wobble: sustained, churchy or retro-funky. Holds each note for its `len`.",
    pitched: true,
    sustained: true,
    range: { low: "C2", high: "C7" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
