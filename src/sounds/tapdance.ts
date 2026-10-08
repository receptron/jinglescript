// Tap dance: a bright metal tap — inharmonic damped modes and a sharp click. "heel" is lower with
// a little thud; "shuffle" is two quick toe taps ~40 ms apart.
import { highpass } from "../dsp/biquad.ts";
import { addModes, buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import type { Rng } from "../rng.ts";
import { addGlide, addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["toe", "heel", "shuffle"] as const;
type Variant = (typeof VARIANTS)[number];
const TOE = [
  { ratio: 3100, level: 1, decay: 0.015 },
  { ratio: 4700, level: 0.6, decay: 0.01 },
  { ratio: 6300, level: 0.35, decay: 0.006 },
];
const HEEL = [
  { ratio: 1800, level: 1, decay: 0.02 },
  { ratio: 2900, level: 0.5, decay: 0.012 },
  { ratio: 4200, level: 0.3, decay: 0.008 },
];
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { toe: -0.7, heel: -1.6, shuffle: -1.3 };

function tap(out: Float32Array, at: number, kind: "toe" | "heel", level: number, rng: Rng, sampleRate: number): void {
  const start = Math.round(at * sampleRate);
  const one = new Float32Array(out.length - start);
  addModes(one, vary(1, 0.03, rng), kind === "toe" ? TOE : HEEL, sampleRate);
  addNoise(one, { decay: 0.001, level: 0.6, filters: [highpass(2000, 0.7, sampleRate)] }, rng, sampleRate);
  if (kind === "heel") addGlide(one, { from: 160, to: 110, glide: 0.02, decay: 0.03, level: 0.6 }, sampleRate);
  one.forEach((v, i) => {
    out[start + i] = (out[start + i] ?? 0) + level * v;
  });
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(variant === "shuffle" ? 0.2 : 0.15, sampleRate);
  tap(out, 0, variant === "heel" ? "heel" : "toe", 1, rng, sampleRate);
  if (variant === "shuffle") tap(out, vary(0.04, 0.1, rng), "toe", 0.7, rng, sampleRate);
  return finish(out, { attack: 0.0005, endFade: 0.01, gain: input.velocity * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const tapdance: Instrument = {
  descriptor: {
    kind: "sfx",
    description: 'Tap-dance taps (sound effect): bright metal taps. Variants "toe" (default), "heel" (lower), "shuffle" (two quick taps).',
    pitched: false,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
