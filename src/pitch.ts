// Pitch names in scientific notation: C4 = middle C = MIDI 60, A4 = 440 Hz.
import * as dmath from "./dsp/math.ts";

export const PITCH_PATTERN = /^([A-G])([#b]?)(-?\d)$/;

const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL_SHIFT: Record<string, number> = { "#": 1, b: -1, "": 0 };

/** MIDI note number of a pitch name such as "C4", "F#3" or "Bb5"; undefined if it is not one. */
export function pitchToMidi(name: string): number | undefined {
  const match = PITCH_PATTERN.exec(name);
  if (!match) return undefined;
  const [, letter = "", accidental = "", octave = ""] = match;
  const base = LETTER_SEMITONE[letter];
  if (base === undefined) return undefined;
  const shift = ACCIDENTAL_SHIFT[accidental] ?? 0;
  return 12 * (Number(octave) + 1) + base + shift;
}

export function midiToFrequency(midi: number): number {
  return 440 * dmath.pow(2, (midi - 69) / 12);
}
