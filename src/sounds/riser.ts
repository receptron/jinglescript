// Riser: builds tension into a hit. "noise": noise through a band-pass sweeping up from 300 Hz to
// 6 kHz. "tone": three slightly detuned band-limited saws gliding up two octaves, with a little
// noise. Both grow louder to the very end, which is the moment that matters — place it with
// `end` on the cue it leads into: { "end": "hit", "len": 4 }.
import { sweptBandpass } from "../dsp/biquad.ts";
import { buffer, finish, partialAllowed } from "../instruments/common.ts";
import type { Instrument, SynthInput } from "../instruments/types.ts";
import { pickVariant } from "./shared.ts";

const VARIANTS = ["noise", "tone"] as const;
type Variant = (typeof VARIANTS)[number];
/** Loudness trims per variant, dB: matched to a C5 marimba note at full velocity (mean over seeds). */
const LEVEL_DB: Record<Variant, number> = { noise: -2.5, tone: 0.7 };
const TONE_FROM_HZ = 110;
const TONE_OCTAVES = 2;
const DETUNE = [0.993, 1, 1.007];
const MAX_HARMONICS = 20;

function noiseRiser(out: Float32Array, seconds: number, input: SynthInput, level: number): void {
  const { sampleRate, rng } = input;
  const noise = Float64Array.from({ length: out.length }, () => rng.normal());
  const filtered = sweptBandpass(noise, (t) => 300 * 20 ** (t / seconds), 1.2, sampleRate);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + level * (filtered[i] ?? 0) * (i / out.length) ** 2;
}

function toneRiser(out: Float32Array, seconds: number, sampleRate: number): void {
  const phases = DETUNE.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const base = TONE_FROM_HZ * 2 ** ((TONE_OCTAVES * t) / seconds);
    let s = 0;
    DETUNE.forEach((d, v) => {
      const f = base * d;
      const phase = phases[v] ?? 0;
      for (let k = 1; k <= MAX_HARMONICS && partialAllowed(k * f, sampleRate); k++) s += Math.sin(k * phase) / k;
      phases[v] = phase + (2 * Math.PI * f) / sampleRate;
    });
    out[i] = (out[i] ?? 0) + 0.25 * s * (i / out.length) ** 2;
  }
}

function synthesize(input: SynthInput): Float32Array {
  const { sampleRate } = input;
  const variant = pickVariant(VARIANTS, input.variant);
  const seconds = input.hold;
  const out = buffer(seconds, sampleRate);
  if (variant === "noise") noiseRiser(out, seconds, input, 1);
  else {
    toneRiser(out, seconds, sampleRate);
    noiseRiser(out, seconds, input, 0.3);
  }
  return finish(out, { attack: 0.001, endFade: 0.015, gain: input.velocity * 10 ** (LEVEL_DB[variant] / 20) }, sampleRate);
}

export const riser: Instrument = {
  descriptor: {
    kind: "sfx",
    description:
      'Riser (sound effect): builds up into a hit. Variants "noise" (default) and "tone". Place it by its end: { "end": "hit", "len": 4 } rises for 4 beats and stops exactly on the cue. Default length 2 s.',
    pitched: false,
    duration: { defaultSeconds: 2 },
    sustained: false,
    range: null,
    variants: VARIANTS,
    transpose: 0,
    synthetic: true,
  },
  synthesize,
};
