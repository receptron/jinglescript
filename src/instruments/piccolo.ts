// Piccolo, from the prototype (instruments2.py): an octave up, sine with weak 2nd and 3rd
// harmonics, breath noise, delayed 5.5 Hz vibrato, ADSR held for the note's length.
// Sounds synthetic — the descriptor says so.
import { accumulatePhase, adsr, buffer, finish, movingAverage, partialAllowed } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";

const HARMONICS = [1, 0.18, 0.05];
const TAIL_SECONDS = 0.3;
/** The prototype's level (0.7), then -5.1 dB to match a C5 at full velocity to the marimba's loudness. */
const LEVEL = 0.7 * 10 ** (-5.1 / 20);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, hold, rng } = input;
  const f = input.frequency ?? 523.25;
  const out = buffer(hold + TAIL_SECONDS, sampleRate);
  const phase = accumulatePhase(out.length, sampleRate, (t) => f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, Math.max(0, (t - 0.12) / 0.2))));
  const breath = movingAverage(
    Float64Array.from({ length: out.length }, () => rng.normal()),
    6,
  );
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    HARMONICS.forEach((level, k) => {
      if (partialAllowed(f * (k + 1), sampleRate)) s += level * Math.sin((k + 1) * (phase[i] ?? 0));
    });
    out[i] = (s + (breath[i] ?? 0) * 0.06) * adsr(i / sampleRate, 0.035, 0.05, 0.85, 0.06, hold);
  }
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * LEVEL }, sampleRate);
}

export const piccolo: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Synthetic piccolo/flute: airy, whistling melody line. Sounds an octave above the written pitch. Sounds synthetic, not like a real flute.",
    pitched: true,
    sustained: true,
    range: { low: "C4", high: "C7" },
    variants: [],
    transpose: 12,
    synthetic: true,
  },
  synthesize,
};
