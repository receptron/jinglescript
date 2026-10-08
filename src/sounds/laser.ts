// Laser "pew": a band-limited sawtooth whose pitch falls exponentially (about three octaves over
// the note's length), with a little fast vibrato, fading as it falls. `pitch` sets where it starts.
import { buffer, finish, partialAllowed } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import * as dmath from "../dsp/math.ts";

const DEFAULT_START_HZ = 2400;
const FALL = 1 / 10;
const MAX_HARMONICS = 30;
const VIBRATO_HZ = 35;
const VIBRATO_DEPTH = 0.03;
/** Loudness trim, dB: matched to a C5 marimba note at full velocity. */
const LEVEL_DB = -1.8;

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate } = input;
  const seconds = input.hold;
  const start = input.frequency ?? DEFAULT_START_HZ;
  const out = buffer(seconds, sampleRate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const f = start * dmath.pow(FALL, t / seconds) * (1 + VIBRATO_DEPTH * dmath.sin(2 * Math.PI * VIBRATO_HZ * t));
    let s = 0;
    // Band-limited: only the harmonics that stay clear of Nyquist at this instant.
    for (let k = 1; k <= MAX_HARMONICS && partialAllowed(k * f, sampleRate); k++) s += dmath.sin(k * phase) / k;
    out[i] = s * 0.6 * dmath.exp((-3 * t) / seconds);
    phase += (2 * Math.PI * f) / sampleRate;
  }
  return finish(out, { attack: 0.001, endFade: 0.01, gain: input.velocity * dmath.dbToGain(LEVEL_DB) }, sampleRate);
}

export const laser: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      "Laser zap 'pew' (sound effect): a falling electronic sweep. Optional `pitch` sets where it starts (default about D7); `len` sets the sweep's length (default 0.25 s).",
    pitched: false,
    pitchOptional: true,
    duration: { defaultSeconds: 0.25 },
    sustained: false,
    range: { low: "C5", high: "C8" },
    variants: [],
    transpose: 0,
    synthetic: true,
  },
  synthesize,
};
