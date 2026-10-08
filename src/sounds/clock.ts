// Clock tick-tock: a very short resonant click — a few damped high modes and a band-passed noise
// burst. "tock" is lower and a little softer. Small seeded variation so a ticking clock is not a
// loop of one sample.
import { bandpass } from "../dsp/biquad.ts";
import { addModes, buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["tick", "tock"] as const;
type Variant = (typeof VARIANTS)[number];

const VOICES: Record<Variant, { modes: { ratio: number; level: number; decay: number }[]; noiseHz: number; level: number }> = {
  tick: {
    modes: [
      { ratio: 2600, level: 1, decay: 0.008 },
      { ratio: 3900, level: 0.6, decay: 0.005 },
      { ratio: 5200, level: 0.3, decay: 0.003 },
    ],
    noiseHz: 4000,
    level: 1,
  },
  tock: {
    modes: [
      { ratio: 1700, level: 1, decay: 0.012 },
      { ratio: 2500, level: 0.6, decay: 0.008 },
      { ratio: 3400, level: 0.3, decay: 0.004 },
    ],
    noiseHz: 2500,
    level: 0.8,
  },
};
const LENGTH_SECONDS = 0.08;
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { tick: 0.0, tock: 0.8 };

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const voice = VOICES[variant];
  const out = buffer(LENGTH_SECONDS, sampleRate);
  addModes(out, vary(1, 0.02, rng), voice.modes, sampleRate);
  addNoise(out, { decay: 0.0015, level: 0.5, filters: [bandpass(voice.noiseHz, 2, sampleRate)] }, rng, sampleRate);
  return finish(out, { attack: 0.0005, endFade: 0.005, gain: input.velocity * voice.level * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const clock: Instrument = {
  descriptor: {
    kind: "sfx",
    description: 'Clock tick-tock (sound effect). Variants "tick" (default) and "tock"; alternate them with "variant": ["tick", "tock"] and `repeat`.',
    pitched: false,
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
