// Impact: the "boom" a reveal lands on — a low falling sine, a noise burst and (hard) a punchier
// mid thump.
import { lowpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addGlide, addNoise, pickVariant } from "./shared.ts";
import * as dmath from "../dsp/math.ts";

const VARIANTS = ["soft", "hard"] as const;
type Variant = (typeof VARIANTS)[number];
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { soft: 3.3, hard: 3.2 };

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  let out: Float32Array;
  if (variant === "hard") {
    out = buffer(1.6, sampleRate);
    addGlide(out, { from: 70, to: 38, glide: 0.15, decay: 0.45, level: 1 }, sampleRate);
    addNoise(out, { decay: 0.02, level: 0.6, filters: [lowpass(3000, 0.7, sampleRate)] }, rng, sampleRate);
    addGlide(out, { from: 180, to: 90, glide: 0.02, decay: 0.06, level: 0.5 }, sampleRate);
  } else {
    out = buffer(1.2, sampleRate);
    addGlide(out, { from: 80, to: 48, glide: 0.12, decay: 0.3, level: 1 }, sampleRate);
    addNoise(out, { decay: 0.03, level: 0.35, filters: [lowpass(1200, 0.7, sampleRate)] }, rng, sampleRate);
  }
  return finish(out, { attack: 0.001, endFade: 0.05, gain: input.velocity * dmath.dbToGain(LEVEL_DB[variant]) }, sampleRate);
}

export const impact: Instrument = {
  descriptor: {
    kind: "sfx",
    description: 'Impact boom (sound effect) for reveals and big landings. Variants "soft" (default) and "hard". Put it on the cue the animation lands on.',
    pitched: false,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
