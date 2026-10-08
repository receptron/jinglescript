// Pistol shot. "shot": a sharp noise crack, a low boom (a falling sine), a short body of low-passed
// noise and a seeded room tail. "cartoon": a lighter "pop" — a band-passed snap and a quick
// falling blip.
import { bandpass, highpass, lowpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addGlide, addNoise, pickVariant } from "./shared.ts";
import * as dmath from "../dsp/math.ts";

const VARIANTS = ["shot", "cartoon"] as const;
type Variant = (typeof VARIANTS)[number];
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { shot: 5.3, cartoon: 5.2 };

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  let out: Float32Array;
  if (variant === "shot") {
    out = buffer(1.2, sampleRate);
    addNoise(out, { decay: 0.003, level: 1, filters: [highpass(800, 0.7, sampleRate)] }, rng, sampleRate);
    addGlide(out, { from: 140, to: 45, glide: 0.05, decay: 0.12, level: 0.9 }, sampleRate);
    addNoise(out, { decay: 0.04, level: 0.5, filters: [lowpass(2000, 0.7, sampleRate)] }, rng, sampleRate);
    addNoise(out, { decay: 0.35, level: 0.08, filters: [lowpass(3500, 0.7, sampleRate)] }, rng, sampleRate);
  } else {
    out = buffer(0.35, sampleRate);
    addNoise(out, { decay: 0.006, level: 0.8, filters: [bandpass(1500, 1, sampleRate)] }, rng, sampleRate);
    addGlide(out, { from: 1000, to: 250, glide: 0.03, decay: 0.05, level: 0.7 }, sampleRate);
  }
  return finish(out, { attack: 0.0005, endFade: 0.02, gain: input.velocity * dmath.dbToGain(LEVEL_DB[variant]) }, sampleRate);
}

export const pistol: Instrument = {
  descriptor: {
    kind: "sfx",
    description: 'Pistol shot (sound effect). Variants "shot" (default: crack and boom) and "cartoon" (a light pop-gun).',
    pitched: false,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: true,
  },
  synthesize,
};
