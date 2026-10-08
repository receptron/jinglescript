// Strums: a chord played string by string, a few ms apart, with a little seeded looseness — the
// slight unevenness of a real hand, which the user liked. Written either as a direction ("down",
// "up") or as a pattern in ukulele-tab style, one character per grid step (eighth notes unless
// `grid` says otherwise): D down, U up, d/u softer, - rest. "D-DU-UDU" is one bar of the classic
// island strum.
import type { Rng } from "./rng.ts";

export const STRUM_PATTERN = /^(down|up|[DUdu-]+)$/;
export const DEFAULT_SPREAD_MS = 15;
export const DEFAULT_GRID_BEATS = 0.5;

export type StrumDirection = "down" | "up";

export interface StrumSpec {
  pattern: string;
  grid?: number;
  spread?: number;
}

export interface StrumSlot {
  /** Beats after the note's `at`. */
  offset: number;
  direction: StrumDirection;
  /** Multiplies the note's velocity. */
  weight: number;
}

const STROKES: Record<string, { direction: StrumDirection; weight: number }> = {
  D: { direction: "down", weight: 1 },
  U: { direction: "up", weight: 0.65 },
  d: { direction: "down", weight: 0.6 },
  u: { direction: "up", weight: 0.45 },
};

export function normalizeStrum(strum: string | StrumSpec): StrumSpec {
  return typeof strum === "string" ? { pattern: strum } : strum;
}

/** The strokes of a strum spec, and the beats one pass of its pattern takes. */
export function strumSlots(spec: StrumSpec): { slots: StrumSlot[]; beats: number } {
  if (spec.pattern === "down" || spec.pattern === "up") return { slots: [{ offset: 0, direction: spec.pattern, weight: 1 }], beats: 0 };
  const grid = spec.grid ?? DEFAULT_GRID_BEATS;
  const slots: StrumSlot[] = [];
  [...spec.pattern].forEach((ch, i) => {
    const stroke = STROKES[ch];
    if (stroke) slots.push({ offset: i * grid, ...stroke });
  });
  return { slots, beats: spec.pattern.length * grid };
}

/** Looseness of a hand: how much the string gaps, onset and per-string velocity may wander. */
const GAP_JITTER = 0.3;
const ONSET_JITTER_MS = 4;
const VELOCITY_JITTER = 0.08;
/** Up-strokes are a touch quicker than down-strokes. */
const UP_SPEED = 0.8;

export interface StrumVoicing {
  /** Seconds after the stroke's onset, per pitch in the order written. */
  offsets: number[];
  /** Velocity multipliers per pitch. */
  weights: number[];
  /** Seconds to shift the whole stroke (0 when it must stay on a cue). */
  shift: number;
}

/**
 * Per-string timing and velocity for one stroke. Pitches are in string order as written: a down
 * stroke plays them first to last, an up stroke last to first.
 */
export function voiceStrum(count: number, direction: StrumDirection, spreadMs: number, pinned: boolean, rng: Rng): StrumVoicing {
  const gap = (spreadMs / 1000) * (direction === "up" ? UP_SPEED : 1);
  const order = Array.from({ length: count }, (_, i) => (direction === "down" ? i : count - 1 - i));
  const offsets = new Array<number>(count).fill(0);
  let t = 0;
  order.forEach((string, k) => {
    if (k > 0) t += gap * (1 + (rng.next() * 2 - 1) * GAP_JITTER);
    offsets[string] = t;
  });
  const weights = Array.from({ length: count }, () => 1 + (rng.next() * 2 - 1) * VELOCITY_JITTER);
  const shift = pinned ? 0 : ((rng.next() * 2 - 1) * ONSET_JITTER_MS) / 1000;
  return { offsets, weights, shift };
}
