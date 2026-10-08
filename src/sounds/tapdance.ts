// Tap dance. Two earlier designs sounded wrong to the user: clean 3–6 kHz modes rang like a small
// bell, and a few sparse metal partials like "hitting an empty can" — any sustained, sparse ring
// reads as a can. What the user picked (by ear, from five candidates): a dry broadband crack with
// a short low knock, plus a wooden floor modelled as forty dense, heavily damped modes (fixed per
// instrument, like one real board) mixed in at 60 % of the crack's peak. Dense and quickly damped,
// the floor adds body without a pitch. "heel" is lower and weightier; "shuffle" is a brush and a
// tap ~40 ms later.
import { bandpass, biquadFilter, highpass } from "../dsp/biquad.ts";
import { addModes, buffer, finish, type Mode } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { createRng, type Rng } from "../rng.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";
import * as dmath from "../dsp/math.ts";

const VARIANTS = ["toe", "heel", "shuffle"] as const;
type Variant = (typeof VARIANTS)[number];

/** The floor: 40 damped modes spread log-evenly at random over 150 Hz – 4 kHz, the same for every tap. */
const FLOOR: readonly Mode[] = (() => {
  const rng = createRng(424242);
  return Array.from({ length: 40 }, () => {
    const hz = 150 * dmath.pow(2, rng.next() * dmath.log2(4000 / 150));
    return { ratio: hz, level: (0.3 + 0.7 * rng.next()) * Math.sqrt(300 / hz), decay: 0.003 + 0.012 * rng.next() * Math.sqrt(600 / hz) };
  });
})();
/** The floor's level: its peak at 60 % of the crack's (1/13 brings the raw floor down to the crack's peak). */
const FLOOR_MIX = 0.6 / 13;
/** Peak trims per variant, dB: a tap peaks like a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { toe: 5.1, heel: 2.8, shuffle: 0 };

interface Tap {
  at: number;
  heel: boolean;
  level: number;
}

function tap(out: Float32Array, { at, heel, level }: Tap, rng: Rng, sampleRate: number): void {
  const start = Math.round(at * sampleRate);
  const one = new Float32Array(out.length - start);
  addNoise(one, { decay: 0.0006, level: 1, filters: [highpass(heel ? 900 : 1500, 0.7, sampleRate)] }, rng, sampleRate);
  addNoise(one, { decay: 0.006, level: heel ? 0.5 : 0.3, filters: [bandpass(heel ? 300 : 450, 0.8, sampleRate)] }, rng, sampleRate);
  const floor = FLOOR.map((m) => ({ ...m, level: m.level * FLOOR_MIX * vary(1, 0.3, rng) * (heel && m.ratio < 500 ? 1.8 : 1) }));
  addModes(one, vary(heel ? 0.85 : 1, 0.03, rng), floor, sampleRate);
  one.forEach((v, i) => {
    out[start + i] = (out[start + i] ?? 0) + level * v;
  });
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(variant === "shuffle" ? 0.2 : 0.15, sampleRate);
  if (variant === "shuffle") {
    // The brush: the plate's edge scraping forward, then the tap as it lands.
    addNoise(out, { decay: 0.012, level: 0.6, filters: [bandpass(2500, 0.8, sampleRate)] }, rng, sampleRate);
    tap(out, { at: vary(0.04, 0.1, rng), heel: false, level: 0.9 }, rng, sampleRate);
  } else {
    tap(out, { at: 0, heel: variant === "heel", level: 1 }, rng, sampleRate);
  }
  // The floor's low modes can leave a little DC; a 40 Hz high-pass takes it out.
  const centred = Float32Array.from(biquadFilter(out, highpass(40, 0.7, sampleRate)));
  return finish(centred, { attack: 0.0005, endFade: 0.01, gain: input.velocity * dmath.dbToGain(LEVEL_DB[variant]) }, sampleRate);
}

export const tapdance: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Tap-dance taps (sound effect): a dry crack on a wooden floor. Variants "toe" (default), "heel" (lower, heavier), "shuffle" (a brush and a tap).',
    pitched: false,
    transient: true,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
