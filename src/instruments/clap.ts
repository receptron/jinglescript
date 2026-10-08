// Hand claps, rebuilt after the user found the prototype's clap (four bursts of near-white noise)
// not good. A clap is band-limited noise — most of its energy sits around 1–2 kHz — shaped by a
// few very short bursts and a short tail, filtered through a couple of resonances. Four variants:
// a drum-machine clap, a snappier one, one natural hand clap, and a small group clapping together.
import { bandpass, biquadFilter } from "../dsp/biquad.ts";
import type { Rng } from "../rng.ts";
import { buffer, finish } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

export const CLAP_VARIANTS = ["studio", "snappy", "hands", "group"] as const;
export type ClapVariant = (typeof CLAP_VARIANTS)[number];
const DEFAULT_VARIANT: ClapVariant = "studio";

interface Burst {
  /** Start, seconds. */
  at: number;
  /** Time constant of its decay, seconds. */
  decay: number;
  level: number;
}

interface Band {
  frequency: number;
  q: number;
  level: number;
}

interface ClapShape {
  bursts: readonly Burst[];
  bands: readonly Band[];
  seconds: number;
}

/** Each burst starts with a 0.3 ms rise rather than a step. */
const BURST_RISE = 0.0003;

const SHAPES: Record<Exclude<ClapVariant, "group">, ClapShape> = {
  // Drum-machine clap: three quick bursts ~10 ms apart, then a 35 ms tail.
  studio: {
    bursts: [
      { at: 0, decay: 0.003, level: 1 },
      { at: 0.01, decay: 0.003, level: 0.9 },
      { at: 0.02, decay: 0.003, level: 0.85 },
      { at: 0.03, decay: 0.035, level: 0.8 },
    ],
    bands: [
      { frequency: 1150, q: 1.3, level: 1 },
      { frequency: 2600, q: 1, level: 0.35 },
    ],
    seconds: 0.3,
  },
  // Tighter and brighter: bursts 7 ms apart, an 18 ms tail.
  snappy: {
    bursts: [
      { at: 0, decay: 0.002, level: 1 },
      { at: 0.007, decay: 0.002, level: 0.9 },
      { at: 0.014, decay: 0.002, level: 0.85 },
      { at: 0.021, decay: 0.018, level: 0.8 },
    ],
    bands: [
      { frequency: 1700, q: 0.9, level: 1 },
      { frequency: 3500, q: 0.8, level: 0.3 },
    ],
    seconds: 0.2,
  },
  // One person's clap: a single crack with the cupped hands' low "pop" resonance.
  hands: {
    bursts: [
      { at: 0, decay: 0.005, level: 1 },
      { at: 0, decay: 0.012, level: 0.3 },
    ],
    bands: [
      { frequency: 1000, q: 1.5, level: 1 },
      { frequency: 2500, q: 1, level: 0.5 },
      { frequency: 700, q: 5, level: 0.6 },
    ],
    seconds: 0.15,
  },
};

function envelope(t: number, bursts: readonly Burst[]): number {
  let e = 0;
  for (const burst of bursts) {
    const local = t - burst.at;
    if (local >= 0) e += burst.level * Math.min(1, local / BURST_RISE) * Math.exp(-local / burst.decay);
  }
  return e;
}

interface Placement {
  /** Frequency scale (bigger or smaller hands). */
  scale: number;
  /** Start, samples. */
  offset: number;
  gain: number;
}

/** One clap of `shape`, placed and scaled, added into `out`. */
function addClap(out: Float32Array, shape: ClapShape, { scale, offset, gain }: Placement, rng: Rng, sampleRate: number): void {
  const n = Math.round(shape.seconds * sampleRate);
  const noise = Float64Array.from({ length: n }, (_, i) => rng.normal() * envelope(i / sampleRate, shape.bursts));
  for (const band of shape.bands) {
    const filtered = biquadFilter(noise, bandpass(band.frequency * scale, band.q, sampleRate));
    for (let i = 0; i < n && offset + i < out.length; i++) out[offset + i] = (out[offset + i] ?? 0) + gain * band.level * (filtered[i] ?? 0);
  }
}

const GROUP_SIZE = 5;
const GROUP_SPREAD_SECONDS = 0.028;

/** Loudness trims per variant, dB: a clap at full velocity matches a C5 marimba note (mean over seeds). */
const LEVEL_DB: Record<ClapVariant, number> = { studio: 8.2, snappy: 6.2, hands: 10.2, group: 5.3 };

function isClapVariant(name: string | undefined): name is ClapVariant {
  return CLAP_VARIANTS.some((v) => v === name);
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const variant = isClapVariant(input.variant) ? input.variant : DEFAULT_VARIANT;
  if (variant !== "group") {
    const out = buffer(SHAPES[variant].seconds, sampleRate);
    addClap(out, SHAPES[variant], { scale: 1, offset: 0, gain: 1 }, rng, sampleRate);
    return finish(out, { attack: 0.0003, endFade: 0.01, gain: input.velocity * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
  }
  // A few people, slightly apart in time and in hand size; the first lands on the onset.
  const out = buffer(SHAPES.hands.seconds + GROUP_SPREAD_SECONDS, sampleRate);
  for (let k = 0; k < GROUP_SIZE; k++) {
    const offset = k === 0 ? 0 : Math.round(rng.next() * GROUP_SPREAD_SECONDS * sampleRate);
    const scale = 0.8 + rng.next() * 0.45;
    const gain = 0.6 + rng.next() * 0.4;
    addClap(out, SHAPES.hands, { scale, offset, gain }, rng, sampleRate);
  }
  return finish(out, { attack: 0.0003, endFade: 0.01, gain: input.velocity * 10 ** (LEVEL_DB.group / 20) }, sampleRate);
}

export const clap: Instrument = {
  descriptor: {
    kind: "instrument",
    description:
      'Hand clap (unpitched). Variants: "studio" (drum-machine clap, the default), "snappy" (tighter, brighter), "hands" (one person, natural), "group" (a few people together). Use `repeat` for claps on every beat.',
    pitched: false,
    sustained: false,
    range: null,
    variants: CLAP_VARIANTS,
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
