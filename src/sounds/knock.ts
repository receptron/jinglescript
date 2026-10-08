// Knock: knuckles on wood. A short knuckle click and the panel's body — a few low resonances of
// the door (or table top) excited by a noise burst. "knock-knock" is two notes, or `repeat`.
import { bandpass, biquadFilter, highpass } from "../dsp/biquad.ts";
import { buffer, finish } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { addNoise, pickVariant, vary } from "./shared.ts";

const VARIANTS = ["door", "table"] as const;
type Variant = (typeof VARIANTS)[number];

/** Panel resonances: Hz, Q, level, decay seconds. */
const PANELS: Record<Variant, { click: number; modes: [number, number, number, number][] }> = {
  door: {
    click: 0.5,
    modes: [
      [180, 3, 1, 0.025],
      [420, 4, 0.6, 0.018],
      [900, 3, 0.3, 0.01],
    ],
  },
  table: {
    click: 0.7,
    modes: [
      [320, 3, 1, 0.018],
      [750, 4, 0.6, 0.012],
      [1600, 3, 0.35, 0.007],
    ],
  },
};
const LENGTH_SECONDS = 0.2;
/** Peak trims per variant, dB: a knock peaks like a C5 marimba note at full velocity. */
const LEVEL_DB: Record<Variant, number> = { door: 17.3, table: 13.5 };

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const panel = PANELS[variant];
  const out = buffer(LENGTH_SECONDS, sampleRate);
  const scale = vary(1, 0.04, rng);
  addNoise(out, { decay: 0.001, level: panel.click, filters: [bandpass(1800 * scale, 1, sampleRate)] }, rng, sampleRate);
  for (const [hz, q, level, decay] of panel.modes) addNoise(out, { decay, level, filters: [bandpass(hz * scale, q, sampleRate)] }, rng, sampleRate);
  const centred = Float32Array.from(biquadFilter(out, highpass(60, 0.7, sampleRate)));
  return finish(centred, { attack: 0.0005, endFade: 0.01, gain: vary(input.velocity, 0.06, rng) * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const knock: Instrument = {
  descriptor: {
    kind: "sfx",
    description: 'Knock on wood (sound effect). Variants "door" (default) and "table". "Knock-knock": two notes about half a beat apart, or `repeat`.',
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
