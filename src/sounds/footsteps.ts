// Footsteps: a low heel thump (a falling sine) and a soft scuff of low-passed noise a few ms
// later as the foot rolls. "left" and "right" differ slightly; each step varies a little (seeded)
// so a walk does not sound like one sample repeated.
import { bandpass, biquadFilter, highpass, lowpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addGlide, addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["left", "right"] as const;
type Variant = (typeof VARIANTS)[number];
const THUMP_HZ: Record<Variant, number> = { left: 110, right: 120 };
const LENGTH_SECONDS = 0.25;
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { left: 4.8, right: 4.6 };

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(LENGTH_SECONDS, sampleRate);
  const thump = vary(THUMP_HZ[variant], 0.08, rng);
  addGlide(out, { from: thump, to: thump * 0.62, glide: 0.02, decay: 0.03, level: 1 }, sampleRate);
  addNoise(
    out,
    { at: vary(0.012, 0.35, rng), decay: 0.025, level: 0.5, filters: [lowpass(1800, 0.7, sampleRate), bandpass(700, 0.5, sampleRate)] },
    rng,
    sampleRate,
  );
  // The thump decays within about a cycle, which leaves it lopsided (DC); a 40 Hz high-pass removes that.
  const centred = Float32Array.from(biquadFilter(out, highpass(40, 0.7, sampleRate)));
  return finish(centred, { attack: 0.001, endFade: 0.01, gain: vary(input.velocity, 0.1, rng) * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const footsteps: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Footsteps (sound effect): a soft heel thump and scuff. Variants "left" (default) and "right"; walk with "variant": ["left", "right"] and `repeat` every 0.5–1 beat.',
    pitched: false,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
