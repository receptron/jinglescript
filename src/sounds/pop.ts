// Pop: a very short resonant blip whose pitch drops — bubbles, items appearing, text popping in.
// An optional `pitch` sets where it starts, so pops can follow a melody.
import { highpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addGlide, addNoise } from "./shared.ts";

const DEFAULT_START_HZ = 1300;
/** Loudness trim, dB: matched to a C5 marimba note at full velocity. */
const LEVEL_DB = -0.4;

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const start = input.frequency ?? DEFAULT_START_HZ;
  const out = buffer(0.12, sampleRate);
  addGlide(out, { from: start, to: start * 0.32, glide: 0.015, decay: 0.03, level: 1 }, sampleRate);
  addNoise(out, { decay: 0.0005, level: 0.2, filters: [highpass(3000, 0.7, sampleRate)] }, rng, sampleRate);
  return finish(out, { attack: 0.0005, endFade: 0.01, gain: input.velocity * 10 ** (LEVEL_DB / 20) }, sampleRate);
}

export const pop: Instrument = {
  descriptor: {
    kind: "sfx",
    description: "Pop (sound effect): a short bubbly blip for things appearing or text popping in. Optional `pitch` sets where it starts.",
    pitched: false,
    pitchOptional: true,
    sustained: false,
    range: { low: "C4", high: "C7" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
