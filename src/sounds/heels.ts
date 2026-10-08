// High heels: the hard heel tip strikes first — a tiny contact click and a resonant "clack" from
// the hollow heel (two band-pass resonances) — then the sole meets the floor ~0.1 s later with a
// softer click. "left" and "right" differ slightly; each step varies a little (seeded).
import { bandpass, biquadFilter, highpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";
import * as dmath from "../dsp/math.ts";

const VARIANTS = ["left", "right"] as const;
type Variant = (typeof VARIANTS)[number];

export interface HeelTone {
  /** The heel's main resonance, Hz, and its sharpness. */
  clackHz: number;
  clackQ: number;
  /** A lower, hollow resonance, Hz. */
  bodyHz: number;
  /** How long the clack rings, seconds. */
  ring: number;
  /** The floor's knock under it. */
  floor: number;
  /** Level of the sole touching down after the heel. */
  sole: number;
}

/** "Block heel on wood", the user's pick of two candidates. */
export const HEEL_TONE: HeelTone = { clackHz: 1600, clackQ: 4, bodyHz: 900, ring: 0.01, floor: 0.6, sole: 0.4 };
const LENGTH_SECONDS = 0.35;
/** Peak trims per variant, dB: a step peaks like a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { left: 10.6, right: 10.8 };

export function heelStep(input: SynthInput, tone: HeelTone, levelDb: number): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(LENGTH_SECONDS, sampleRate);
  const clack = vary(tone.clackHz * (variant === "right" ? 1.04 : 1), 0.04, rng);
  addNoise(out, { decay: 0.0004, level: 0.6, filters: [highpass(2000, 0.7, sampleRate)] }, rng, sampleRate);
  addNoise(out, { decay: tone.ring, level: 1, filters: [bandpass(clack, tone.clackQ, sampleRate)] }, rng, sampleRate);
  addNoise(out, { decay: tone.ring * 1.6, level: 0.6, filters: [bandpass(tone.bodyHz, 4, sampleRate)] }, rng, sampleRate);
  addNoise(out, { decay: 0.008, level: tone.floor, filters: [bandpass(500, 1, sampleRate)] }, rng, sampleRate);
  // The sole, a softer and duller click a moment later.
  addNoise(out, { at: vary(0.11, 0.2, rng), decay: 0.008, level: tone.sole, filters: [bandpass(clack * 0.75, 3, sampleRate)] }, rng, sampleRate);
  const centred = Float32Array.from(biquadFilter(out, highpass(60, 0.7, sampleRate)));
  return finish(centred, { attack: 0.0005, endFade: 0.01, gain: vary(input.velocity, 0.08, rng) * dmath.dbToGain(levelDb) }, sampleRate);
}

export const heels: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'High-heel footsteps (sound effect): a sharp clack and the sole after it. Variants "left" (default) and "right"; walk with "variant": ["left", "right"] and `repeat`.',
    pitched: false,
    transient: true,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => heelStep(input, HEEL_TONE, LEVEL_DB[pickVariant(VARIANTS, input.variant)]),
};
