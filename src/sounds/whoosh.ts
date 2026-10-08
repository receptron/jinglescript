// Whoosh: noise through a band-pass whose centre sweeps up and back down while the level rises
// and falls — something flying past. "fast" is brighter with a later, sharper peak. `len` sets
// how long it takes (default 0.5 s).
import { sweptBandpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { pickVariant } from "./shared.ts";

const VARIANTS = ["soft", "fast"] as const;
type Variant = (typeof VARIANTS)[number];
const SHAPES: Record<Variant, { peak: number; low: number; high: number; q: number }> = {
  soft: { peak: 0.55, low: 300, high: 1800, q: 0.8 },
  fast: { peak: 0.7, low: 600, high: 4500, q: 1.5 },
};
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { soft: -2.0, fast: -3.6 };

/** 0 → 1 at the peak → 0, smoothly. */
function riseFall(x: number, peak: number): number {
  if (x <= 0 || x >= 1) return 0;
  return x < peak ? Math.sin((Math.PI / 2) * (x / peak)) ** 2 : Math.cos((Math.PI / 2) * ((x - peak) / (1 - peak))) ** 1.5;
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const shape = SHAPES[variant];
  const seconds = input.hold;
  const out = buffer(seconds, sampleRate);
  const noise = Float64Array.from({ length: out.length }, () => rng.normal());
  const filtered = sweptBandpass(noise, (t) => shape.low * (shape.high / shape.low) ** riseFall(t / seconds, shape.peak), shape.q, sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = (filtered[i] ?? 0) * riseFall(i / out.length, shape.peak);
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const whoosh: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Whoosh (sound effect) for transitions and things flying past. Variants "soft" (default) and "fast". `len` sets its length (default 0.5 s); place it with "end" to finish on a cut.',
    pitched: false,
    duration: { defaultSeconds: 0.5 },
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
