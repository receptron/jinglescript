// Tap dance, rebuilt after the user found the first version (clean 3–6 kHz modes) "a little
// strange" — a small bell, not a shoe. A tap is a metal plate hitting a wooden floor: a sharp
// broadband crack, a very short dense metallic ring, and the floor's knock. "heel" is the bigger,
// lower plate with more floor; "shuffle" is a quick brush followed by a tap ~40 ms later.
import { bandpass, biquadFilter, highpass, lowpass } from "../dsp/biquad.ts";
import { addModes, buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import type { Rng } from "../rng.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["toe", "heel", "shuffle"] as const;
type Variant = (typeof VARIANTS)[number];

export interface TapTone {
  /** Level of the broadband crack. */
  crack: number;
  /** Level of the metallic ring. */
  ring: number;
  /** Ring decay, seconds (short = a click, long = a bell). */
  ringDecay: number;
  /** Level of the wooden floor's knock. */
  floor: number;
  /** Centre of the floor's knock, Hz. */
  floorHz: number;
  /** Level of the low thud of the floorboards (weight). */
  thud: number;
  /** Scales the plate's partials (lower = a bigger, heavier plate). */
  plate: number;
}

export const TAP_TONE: TapTone = { crack: 0.8, ring: 0.6, ringDecay: 0.012, floor: 0.25, floorHz: 700, thud: 0, plate: 1 };
/** Inharmonic plate partials, Hz (dense, so the ring reads as metal rather than a pitch). */
const PLATE = [2350, 3420, 4890, 6710, 8230];
/** Peak trims per variant, dB: a tap peaks like a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { toe: 3.5, heel: 4.1, shuffle: -1.3 };

interface Tap {
  at: number;
  heel: boolean;
  level: number;
}

function tap(out: Float32Array, { at, heel, level }: Tap, tone: TapTone, rng: Rng, sampleRate: number): void {
  const start = Math.round(at * sampleRate);
  const one = new Float32Array(out.length - start);
  const scale = vary((heel ? 0.7 : 1) * tone.plate, 0.04, rng);
  addNoise(one, { decay: 0.0006, level: tone.crack * (heel ? 0.8 : 1), filters: [highpass(heel ? 900 : 1500, 0.7, sampleRate)] }, rng, sampleRate);
  addModes(
    one,
    scale,
    PLATE.map((hz, k) => ({ ratio: hz, level: tone.ring / (k + 1), decay: tone.ringDecay * (1 - k * 0.12) })),
    sampleRate,
  );
  addNoise(one, { decay: 0.01, level: tone.floor * (heel ? 1.5 : 1), filters: [bandpass(tone.floorHz * (heel ? 0.6 : 1), 1.5, sampleRate)] }, rng, sampleRate);
  if (tone.thud > 0) {
    addNoise(
      one,
      { decay: 0.018, level: tone.thud * (heel ? 1.4 : 1), filters: [bandpass(heel ? 160 : 210, 1.2, sampleRate), lowpass(600, 0.7, sampleRate)] },
      rng,
      sampleRate,
    );
  }
  one.forEach((v, i) => {
    out[start + i] = (out[start + i] ?? 0) + level * v;
  });
}

export function tapSound(input: SynthInput, tone: TapTone, levelDb: number): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const out = buffer(variant === "shuffle" ? 0.2 : 0.15, sampleRate);
  if (variant === "shuffle") {
    // The brush: the plate's edge scraping forward, then the tap as it lands.
    addNoise(out, { decay: 0.012, level: 0.9, filters: [bandpass(3000, 0.8, sampleRate)] }, rng, sampleRate);
    tap(out, { at: vary(0.04, 0.1, rng), heel: false, level: 0.9 }, tone, rng, sampleRate);
  } else {
    tap(out, { at: 0, heel: variant === "heel", level: 1 }, tone, rng, sampleRate);
  }
  // The floor thud can leave a little DC; a 40 Hz high-pass takes it out.
  const centred = Float32Array.from(biquadFilter(out, highpass(40, 0.7, sampleRate)));
  return finish(centred, { attack: 0.0005, endFade: 0.01, gain: input.velocity * 10 ** (levelDb / 20) }, sampleRate);
}

export const tapdance: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Tap-dance taps (sound effect): metal plates on a wooden floor. Variants "toe" (default), "heel" (lower, heavier), "shuffle" (a brush and a tap).',
    pitched: false,
    transient: true,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => tapSound(input, TAP_TONE, LEVEL_DB[pickVariant(VARIANTS, input.variant)]),
};
