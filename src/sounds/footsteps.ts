// Footsteps, rebuilt after the user found the first version (a falling-sine thump) "a little
// strange" — it was a drum, not a foot. A step is noise, not a tone: the heel strikes (a short
// noise burst coloured by the floor's low resonance, with a tiny contact click), the toe follows
// a few tens of ms later, more softly, and the sole scuffs. "left" and "right" differ slightly,
// and each step varies a little (seeded), so a walk is not one sample repeated.
import { bandpass, biquadFilter, highpass, lowpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import type { Rng } from "../rng.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["left", "right"] as const;
type Variant = (typeof VARIANTS)[number];

export interface FootTone {
  /** The floor's resonance under the heel, Hz. */
  floorHz: number;
  /** Sharpness of the contact click (0 = none). */
  click: number;
  /** Level of the toe relative to the heel. */
  toe: number;
  /** Sole scuff level. */
  scuff: number;
  /** A hollow wooden-floor resonance (0 = none). */
  wood: number;
}

export const FOOT_TONE: FootTone = { floorHz: 160, click: 0.12, toe: 0.5, scuff: 0.1, wood: 0 };
const LENGTH_SECONDS = 0.3;
/** Peak trims per variant, dB: a step peaks like a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { left: 21.4, right: 21.2 };

interface Strike {
  at: number;
  level: number;
  floorHz: number;
}

function impact(out: Float32Array, { at, level, floorHz }: Strike, tone: FootTone, rng: Rng, sampleRate: number): void {
  addNoise(out, { at, decay: 0.006, level, filters: [bandpass(floorHz, 1.4, sampleRate), lowpass(1200, 0.7, sampleRate)] }, rng, sampleRate);
  if (tone.click > 0) addNoise(out, { at, decay: 0.0008, level: level * tone.click, filters: [highpass(2500, 0.7, sampleRate)] }, rng, sampleRate);
  if (tone.wood > 0) addNoise(out, { at, decay: 0.02, level: level * tone.wood, filters: [bandpass(600, 3, sampleRate)] }, rng, sampleRate);
}

export function footstep(input: SynthInput, tone: FootTone, levelDb: number): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(LENGTH_SECONDS, sampleRate);
  const floor = vary(tone.floorHz * (variant === "right" ? 1.06 : 1), 0.08, rng);
  impact(out, { at: 0, level: 1, floorHz: floor }, tone, rng, sampleRate);
  impact(out, { at: vary(0.055, 0.25, rng), level: vary(tone.toe, 0.15, rng), floorHz: floor * 1.3 }, tone, rng, sampleRate);
  addNoise(out, { at: vary(0.02, 0.3, rng), decay: 0.03, level: tone.scuff, filters: [bandpass(1500, 0.7, sampleRate)] }, rng, sampleRate);
  // Filtered noise bursts can leave a little DC; a 40 Hz high-pass takes it out.
  const centred = Float32Array.from(biquadFilter(out, highpass(40, 0.7, sampleRate)));
  return finish(centred, { attack: 0.0005, endFade: 0.01, gain: vary(input.velocity, 0.1, rng) * 10 ** (levelDb / 20) }, sampleRate);
}

export const footsteps: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Footsteps (sound effect): heel, toe and scuff of an ordinary shoe. Variants "left" (default) and "right"; walk with "variant": ["left", "right"] and `repeat` every 0.5–1 beat.',
    pitched: false,
    transient: true,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => footstep(input, FOOT_TONE, LEVEL_DB[pickVariant(VARIANTS, input.variant)]),
};
