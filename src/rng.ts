// Seeded randomness. Every random component of a render draws from a stream derived from the
// score's seed and a key naming what it is for (a note's position, the reverb), so a stream does
// not depend on how many other streams were used before it: adding a track leaves every other
// track's noise unchanged.
import * as dmath from "./dsp/math.ts";

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal (Box–Muller). */
  normal(): number;
}

/** 32-bit hash of a seed and a key (FNV-1a over their text, then a murmur3 finaliser). */
export function streamSeed(seed: number, ...key: readonly (string | number)[]): number {
  // The seed enters only through the text: also XOR-ing it into the initial state cancels against
  // its own first digit, and seeds 1 and 2 then hash alike.
  let h = 0x811c9dc5;
  for (const ch of `${seed}|${key.join("|")}`) {
    h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: small, fast, and identical on every machine. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (): number => {
    const u = 1 - next(); // (0, 1], so log(u) is finite
    const v = next();
    return Math.sqrt(-2 * dmath.log(u)) * dmath.cos(2 * Math.PI * v);
  };
  return { next, normal };
}

export function streamRng(seed: number, ...key: readonly (string | number)[]): Rng {
  return createRng(streamSeed(seed, ...key));
}
