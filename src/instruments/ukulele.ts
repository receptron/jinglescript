// Ukulele: a Karplus–Strong plucked string, reworked for a soft nylon-string sound after the user
// heard the prototype-style string (loss 0.996, raw-noise pluck) as a koto — bright, twangy and
// ringing too long. What makes it soft:
// - a finger pluck: the excitation is low-passed and comb-filtered at the pluck position;
// - highs that die fast: a one-pole low-pass inside the loop (its delay is compensated, so the
//   pitch stays exact; a first-order all-pass supplies the remaining fraction of a sample);
// - a short ring: the loop gain gives a fixed decay time, shorter for higher notes;
// - a mellow body: a gentle low-pass on the output.
import { buffer, finish } from "./common.ts";
import type { Rng } from "../rng.ts";
import type { Instrument, SynthInput } from "./types.ts";
import * as dmath from "../dsp/math.ts";

export interface StringTone {
  /** Low-pass on the excitation, Hz: lower is a softer, fleshier pluck. */
  pluckHz: number;
  /** Where along the string it is plucked, 0–0.5 (0.5 = the middle, the softest). */
  pluckPosition: number;
  /** One-pole low-pass coefficient inside the loop, 0–0.9: higher makes the highs die faster. */
  damping: number;
  /** Seconds to fall 60 dB at middle C; scales with 1/√f, so higher notes ring shorter. */
  ringSeconds: number;
  /** Low-pass on the output, Hz. */
  bodyHz: number;
}

/** The softest of three candidates, chosen by the user by ear ("3-softest"). */
export const SOFT_TONE: StringTone = { pluckHz: 500, pluckPosition: 0.3, damping: 0.65, ringSeconds: 2.0, bodyHz: 2200 };

const RING_SECONDS = 2.2;
const DAMPER_SECONDS = 0.3;
/** Loudness trim, dB: a C5 at full velocity matched to the marimba's. */
const LEVEL_DB = 7.7;

function onePole(x: Float64Array, coefficient: number, passes: number, circular: boolean): void {
  let state = 0;
  if (circular) for (const v of x) state = (1 - coefficient) * v + coefficient * state;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < x.length; i++) {
      state = (1 - coefficient) * (x[i] ?? 0) + coefficient * state;
      x[i] = state;
    }
  }
}

/** One period of string shape: seeded noise, low-passed, comb-filtered at the pluck position, zero-mean, peak 1. */
function pluckExcitation(line: number, tone: StringTone, rng: Rng, sampleRate: number): Float64Array {
  const noise = Float64Array.from({ length: line }, () => rng.next() * 2 - 1);
  onePole(noise, dmath.exp((-2 * Math.PI * tone.pluckHz) / sampleRate), 2, true);
  const offset = Math.max(1, Math.round(tone.pluckPosition * line));
  const shaped = Float64Array.from({ length: line }, (_, i) => (noise[i] ?? 0) - (noise[(i - offset + line) % line] ?? 0));
  const mean = shaped.reduce((sum, v) => sum + v, 0) / line;
  const peak = shaped.reduce((m, v) => Math.max(m, Math.abs(v - mean)), 0) || 1;
  return shaped.map((v) => (v - mean) / peak);
}

/** Phase delay, in samples, of the one-pole y = (1−b)x + b·y₋₁ at angular frequency w. */
function onePoleDelay(b: number, w: number): number {
  return dmath.atan2(b * dmath.sin(w), 1 - b * dmath.cos(w)) / w;
}

/** Phase delay of the all-pass (c + z⁻¹)/(1 + c·z⁻¹) at w. */
function allpassDelay(c: number, w: number): number {
  const phase = dmath.atan2(-dmath.sin(w), c + dmath.cos(w)) - dmath.atan2(-c * dmath.sin(w), 1 + c * dmath.cos(w));
  return -phase / w;
}

/** The all-pass coefficient whose delay at w is `target` samples (bisection; the delay falls as c rises). */
function allpassFor(target: number, w: number): number {
  let low = -0.99;
  let high = 0.99;
  for (let k = 0; k < 60; k++) {
    const mid = (low + high) / 2;
    if (allpassDelay(mid, w) > target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function pluckString(input: SynthInput, tone: StringTone, levelDb: number): Float32Array {
  const { sampleRate, rng } = input;
  const f = input.frequency ?? 261.63;
  const w = (2 * Math.PI * f) / sampleRate;
  const period = sampleRate / f;
  const filterDelay = onePoleDelay(tone.damping, w);
  // Loop delay = line + one-pole delay + all-pass delay, the all-pass kept in [0.1, 1.1).
  const line = Math.max(2, Math.floor(period - filterDelay - 0.1));
  const c = allpassFor(period - filterDelay - line, w);
  // Loop gain per period for the wanted decay time; the one-pole has unit gain at DC and loses
  // a little at f, so take that out of the budget.
  const ring = tone.ringSeconds * Math.sqrt(261.63 / f);
  const filterGain = (1 - tone.damping) / dmath.hypot(1 - tone.damping * dmath.cos(w), tone.damping * dmath.sin(w));
  const loss = Math.min(0.9999, dmath.pow(10, -3 / (ring * f)) / filterGain);

  const delay = pluckExcitation(line, tone, rng, sampleRate);
  const out = buffer(RING_SECONDS + DAMPER_SECONDS, sampleRate);
  let lowpassed = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i % line;
    const y = delay[p] ?? 0;
    out[i] = y;
    lowpassed = (1 - tone.damping) * loss * y + tone.damping * lowpassed;
    const shifted = c * lowpassed + apIn - c * apOut;
    apIn = lowpassed;
    apOut = shifted;
    delay[p] = shifted;
  }
  const body = Float64Array.from(out);
  onePole(body, dmath.exp((-2 * Math.PI * tone.bodyHz) / sampleRate), 1, false);
  return finish(Float32Array.from(body), { attack: 0.002, endFade: DAMPER_SECONDS, gain: input.velocity * dmath.dbToGain(levelDb) }, sampleRate);
}

export const ukulele: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Nylon-string ukulele, finger-plucked: soft, warm, short ring. Happy vlog and family-channel tunes, gentle strums.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C6" },
    variants: [],
    // Re-entrant GCEA, high G: a down-strum goes G4, C4, E4, A4.
    tuning: ["G4", "C4", "E4", "A4"],
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => pluckString(input, SOFT_TONE, LEVEL_DB),
};
