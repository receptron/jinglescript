// Hand clap, from the prototype (instruments.py): four short filtered noise bursts at 0, 11, 22
// and 35 ms, the last one longer, through a gentle high-pass (1 − 0.6·z⁻¹).
import { buffer, finish } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

const BURSTS = [
  { at: 0, seconds: 0.008, decay: 0.003 },
  { at: 0.011, seconds: 0.008, decay: 0.003 },
  { at: 0.022, seconds: 0.008, decay: 0.003 },
  { at: 0.035, seconds: 0.06, decay: 0.02 },
];
const LENGTH_SECONDS = 0.25;
/** The prototype's level (0.5), then +0.8 dB to match a C5 at full velocity to the marimba's loudness. */
const LEVEL = 0.5 * 10 ** (0.8 / 20);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, rng } = input;
  const raw = new Float64Array(Math.round(LENGTH_SECONDS * sampleRate));
  for (const burst of BURSTS) {
    const start = Math.round(burst.at * sampleRate);
    const n = Math.round(burst.seconds * sampleRate);
    for (let j = 0; j < n && start + j < raw.length; j++) raw[start + j] = (raw[start + j] ?? 0) + rng.normal() * Math.exp(-j / (sampleRate * burst.decay));
  }
  const out = buffer(LENGTH_SECONDS, sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = (raw[i] ?? 0) - 0.6 * (raw[i - 1] ?? 0);
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * LEVEL }, sampleRate);
}

export const clap: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Hand clap (unpitched): claps on the beat, on the hit, or repeated with `repeat`.",
    pitched: false,
    sustained: false,
    range: null,
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
