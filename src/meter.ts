// Time and key signatures, as a score writes them ("3/4", "G", "Em"). They only matter for sheet
// music: the audio never reads them. Parsed here so the schema, the checks and the notation agree.

export const METER_PATTERN = /^([1-9]|1[0-6])\/(2|4|8|16)$/;
export const DEFAULT_METER = "4/4";

export interface Meter {
  /** Beats per bar, as written on top ("3" of 3/4). */
  beats: number;
  /** The note value of one of them, as written below ("4" of 3/4: a quarter note). */
  beatType: number;
}

export function parseMeter(text: string): Meter | undefined {
  const match = METER_PATTERN.exec(text);
  if (!match) return undefined;
  return { beats: Number(match[1]), beatType: Number(match[2]) };
}

/** Quarter notes in one bar: 4 in 4/4, 3 in 3/4 and in 6/8. */
export function barQuarters(meter: Meter): number {
  return (meter.beats * 4) / meter.beatType;
}

/** 6/8, 9/8, 12/8 (and 6/16…): felt in dotted beats of three. */
export function isCompound(meter: Meter): boolean {
  return meter.beatType >= 8 && meter.beats % 3 === 0 && meter.beats > 3;
}

export const KEY_PATTERN = /^([A-G][#b]?)(m?)$/;
export const DEFAULT_KEY = "C";

/** Tonics along the line of fifths; C is at FIFTHS_ORIGIN. */
const LINE_OF_FIFTHS = ["Fb", "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "E#", "B#"];
const FIFTHS_ORIGIN = LINE_OF_FIFTHS.indexOf("C");

export interface KeySignature {
  /** Sharps (positive) or flats (negative) in the signature. */
  fifths: number;
  mode: "major" | "minor";
}

/** The signature of a key such as "G", "Bb" or "F#m"; undefined when it needs more than seven sharps or flats. */
export function parseKey(text: string): KeySignature | undefined {
  const match = KEY_PATTERN.exec(text);
  if (!match) return undefined;
  const tonic = LINE_OF_FIFTHS.indexOf(match[1] ?? "");
  if (tonic < 0) return undefined;
  const minor = match[2] === "m";
  const fifths = tonic - FIFTHS_ORIGIN - (minor ? 3 : 0);
  return Math.abs(fifths) <= 7 ? { fifths, mode: minor ? "minor" : "major" } : undefined;
}

/** Keys an LLM may write: every major and minor key with up to seven sharps or flats. */
export const KEYS: readonly string[] = LINE_OF_FIFTHS.flatMap((tonic) => [tonic, `${tonic}m`]).filter((key) => parseKey(key) !== undefined);
