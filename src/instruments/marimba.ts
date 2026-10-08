// Marimba, ported from reference/prototype/marimba.py (`bar`), the sound the user approved.
// A tuned bar: three damped modes at 1×, 3.93× and 9.2× the fundamental, lower bars ringing
// longer, a short low-passed noise click for the mallet, and a 1.5 ms onset ramp.
//
// Differences from the prototype, all at the edges: the note rings until it is ~60 dB down rather
// than being cut at 2.5 s (which clicked on low notes), it ends in a short fade, and a mode that
// would come too close to Nyquist is dropped.
import { addDampedSine, MAX_PARTIAL_FRACTION, movingAverage, RING_TIME_CONSTANTS } from "./common.ts";
import type { Instrument, SynthInput } from "./types.ts";
import * as dmath from "../dsp/math.ts";

const MODES = [
  { ratio: 1, level: 1, decay: 0.42, lowRingsLonger: true },
  { ratio: 3.93, level: 0.35, decay: 0.09, lowRingsLonger: true },
  { ratio: 9.2, level: 0.12, decay: 0.035, lowRingsLonger: false },
] as const;

const CLICK_SECONDS = 0.006;
const CLICK_LEVEL = 0.25;
/** The prototype smoothed the click with a 12-tap moving average at 48 kHz. */
const CLICK_SMOOTH_SECONDS = 12 / 48000;
const ATTACK_SECONDS = 0.0015;
const MIN_SECONDS = 2.5;
const END_FADE_SECONDS = 0.01;

/** Lower bars ring longer: 1× at middle C and above, up to 2× two octaves below. */
function lowFactor(midi: number): number {
  return 1 + Math.max(0, (60 - midi) / 24);
}

function malletClick(sampleRate: number, input: SynthInput): Float32Array {
  const n = Math.round(sampleRate * CLICK_SECONDS);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hann = n > 1 ? 0.5 - 0.5 * dmath.cos((2 * Math.PI * i) / (n - 1)) : 1;
    raw[i] = input.rng.normal() * hann * CLICK_LEVEL;
  }
  const taps = Math.max(1, Math.round(sampleRate * CLICK_SMOOTH_SECONDS));
  return movingAverage(raw, taps);
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate, velocity } = input;
  const midi = input.midi ?? 60;
  const frequency = input.frequency ?? 261.63;
  const low = lowFactor(midi);
  const seconds = Math.max(MIN_SECONDS, RING_TIME_CONSTANTS * MODES[0].decay * low);
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  const maxPartial = sampleRate * MAX_PARTIAL_FRACTION;

  for (const mode of MODES) {
    const f = frequency * mode.ratio;
    if (f >= maxPartial) continue;
    const tau = mode.decay * (mode.lowRingsLonger ? low : 1);
    addDampedSine(out, (2 * Math.PI * f) / sampleRate, mode.level, tau, sampleRate);
  }
  const click = malletClick(sampleRate, input);
  click.forEach((c, i) => {
    out[i] = (out[i] ?? 0) + c;
  });

  const attack = ATTACK_SECONDS * sampleRate;
  const fade = Math.round(END_FADE_SECONDS * sampleRate);
  for (let i = 0; i < length; i++) {
    const onset = Math.min(1, i / attack);
    const end = Math.min(1, (length - 1 - i) / fade);
    out[i] = (out[i] ?? 0) * onset * end * velocity;
  }
  return out;
}

export const marimba: Instrument = {
  descriptor: {
    kind: "instrument",
    description:
      "Wooden bar struck with a soft mallet: warm, round, bouncy. The default for friendly openings, question-and-answer melodies and big chord hits with a low bass.",
    pitched: true,
    sustained: false,
    range: { low: "C2", high: "C7" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize,
};
