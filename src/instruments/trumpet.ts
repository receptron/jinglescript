// Trumpet, from the prototype (instruments2.py): harmonics 1…13 that brighten as the envelope
// rises, a lip "scoop" up into the pitch, delayed 5.2 Hz vibrato, ADSR held for the note's length.
// Sounds synthetic — the descriptor says so.
import { accumulatePhase, adsr, buffer, finish, partialAllowed } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";
import * as dmath from "../dsp/math.ts";

const HARMONICS = 13;
const TAIL_SECONDS = 0.3;
/** The prototype's level (0.35), then -0.3 dB to match a C5 at full velocity to the marimba's loudness. */
const LEVEL = 0.35 * dmath.dbToGain(-0.3);

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, hold } = input;
  const f = input.frequency ?? 261.63;
  const out = buffer(hold + TAIL_SECONDS, sampleRate);
  const phase = accumulatePhase(out.length, sampleRate, (t) => {
    const scoop = 1 - 0.03 * dmath.exp(-t / 0.03);
    const vibrato = 1 + 0.004 * dmath.sin(2 * Math.PI * 5.2 * t) * Math.min(1, Math.max(0, (t - 0.15) / 0.2));
    return f * scoop * vibrato;
  });
  let harmonics = 0;
  while (harmonics < HARMONICS && partialAllowed(f * (harmonics + 1), sampleRate)) harmonics++;
  for (let i = 0; i < out.length; i++) {
    const e = adsr(i / sampleRate, 0.025, 0.08, 0.8, 0.07, hold);
    const bright = 0.35 + 0.65 * e;
    let s = 0;
    for (let k = 1; k <= harmonics; k++) s += (dmath.pow(bright, k - 1) / dmath.pow(k, 0.7)) * dmath.sin(k * (phase[i] ?? 0));
    out[i] = s * e;
  }
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * LEVEL }, sampleRate);
}

export const trumpet: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Synthetic trumpet: bright brass fanfare line. Sounds synthetic, not like a real trumpet.",
    pitched: true,
    sustained: true,
    range: { low: "E3", high: "C6" },
    variants: [],
    transpose: 0,
    synthetic: true,
  },
  synthesize,
};
