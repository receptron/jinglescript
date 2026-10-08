// Small reverbs, as in the prototype: convolve with an impulse response that is the dry signal
// plus seeded, exponentially decaying noise.
import { streamRng } from "../rng.ts";
import { convolve } from "./fft.ts";

export const REVERBS = ["none", "room", "hall"] as const;
export type Reverb = (typeof REVERBS)[number];

interface ReverbShape {
  /** Time constant of the noise tail, seconds. */
  decay: number;
  /** Length of the impulse response, seconds. */
  seconds: number;
  /** Tail level per sample at 48 kHz (the prototype's room used 0.012). */
  level: number;
}

const SHAPES: Record<Exclude<Reverb, "none">, ReverbShape> = {
  room: { decay: 0.18, seconds: 0.9, level: 0.012 },
  // About the same tail energy as the room, spread over a longer decay.
  hall: { decay: 0.5, seconds: 2.5, level: 0.0072 },
};

export function impulseResponse(reverb: Exclude<Reverb, "none">, sampleRate: number, seed: number): Float64Array {
  const shape = SHAPES[reverb];
  const rng = streamRng(seed, "reverb", reverb);
  const n = Math.round(shape.seconds * sampleRate);
  // Keep the tail's energy independent of the sample rate.
  const level = shape.level * Math.sqrt(48000 / sampleRate);
  const ir = new Float64Array(n);
  for (let i = 0; i < n; i++) ir[i] = rng.normal() * Math.exp(-i / sampleRate / shape.decay) * level;
  ir[0] = 1;
  return ir;
}

export function applyReverb(channels: [Float32Array, Float32Array], reverb: Reverb, sampleRate: number, seed: number): [Float32Array, Float32Array] {
  if (reverb === "none") return channels;
  const ir = impulseResponse(reverb, sampleRate, seed);
  return [convolve(channels[0], ir), convolve(channels[1], ir)];
}
