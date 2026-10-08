// Chord symbols ("C", "Am", "G7", "Fmaj7", "Bb", "F#m7", "Dsus4") → pitches. An LLM writes the
// chord name; the instrument decides the voicing. Fretted instruments with a `tuning` get a real,
// playable shape found by searching their frets (C on a ukulele is 0003, G7 is 0212); everything
// else gets the chord stacked in root position from octave 4.
import { pitchToMidi } from "./pitch.ts";

const QUALITIES = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
} as const satisfies Record<string, readonly number[]>;

type Quality = keyof typeof QUALITIES;
export const CHORD_QUALITIES = Object.keys(QUALITIES);
// Longest alternatives first so "maj7" is not read as "m" + "aj7".
const QUALITY_ALTERNATION = [...CHORD_QUALITIES].sort((a, b) => b.length - a.length || a.localeCompare(b)).join("|");
export const CHORD_PATTERN = new RegExp(`^([A-G][#b]?)(${QUALITY_ALTERNATION})$`);

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function isQuality(name: string): name is Quality {
  return CHORD_QUALITIES.includes(name);
}

export interface ChordTones {
  /** Pitch class of the root, 0 = C. */
  root: number;
  /** Semitones above the root. */
  intervals: readonly number[];
  /** Spell with flats (the symbol used a flat, or F). */
  flats: boolean;
}

export function parseChord(symbol: string): ChordTones | undefined {
  const match = CHORD_PATTERN.exec(symbol);
  if (!match) return undefined;
  const [, rootName = "", quality = ""] = match;
  const rootMidi = pitchToMidi(`${rootName}4`);
  if (rootMidi === undefined || !isQuality(quality)) return undefined;
  return { root: rootMidi % 12, intervals: QUALITIES[quality], flats: rootName.includes("b") || rootName === "F" };
}

export function midiToPitch(midi: number, flats: boolean): string {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((midi % 12) + 12) % 12] ?? "C"}${Math.floor(midi / 12) - 1}`;
}

/** Root position, the root in octave 4. */
function stacked(chord: ChordTones): string[] {
  const root = 60 + chord.root;
  return chord.intervals.map((interval) => midiToPitch(root + interval, chord.flats));
}

const MAX_FRET = 7;

/** A fret per string; lower is better. Infinity when it does not spell the chord. */
function shapeCost(frets: readonly number[], open: readonly number[], chord: ChordTones): number {
  const classes = new Set<number>();
  for (let s = 0; s < frets.length; s++) {
    const pc = ((open[s] ?? 0) + (frets[s] ?? 0) - chord.root + 120) % 12;
    if (!chord.intervals.some((i) => i % 12 === pc)) return Infinity;
    classes.add(pc);
  }
  // Every tone must sound, except the fifth when a four-note chord meets four strings.
  const needed = chord.intervals.map((i) => i % 12).filter((pc) => !(pc === 7 && chord.intervals.length >= frets.length));
  if (!needed.every((pc) => classes.has(pc))) return Infinity;
  const fretted = frets.filter((f) => f > 0);
  const span = fretted.length > 1 ? Math.max(...fretted) - Math.min(...fretted) : 0;
  const sum = frets.reduce((a, b) => a + b, 0);
  const opens = frets.length - fretted.length;
  const high = Math.max(...frets) > 4 ? 20 : 0;
  return span * 10 + sum + high - opens * 0.5;
}

/** The cheapest playable shape on a fretted instrument, in string order (as `tuning` lists them). */
function fretted(chord: ChordTones, tuning: readonly string[]): string[] {
  const open = tuning.map((p) => pitchToMidi(p) ?? 60);
  let best: number[] | undefined;
  let bestCost = Infinity;
  const frets = new Array<number>(open.length).fill(0);
  const total = (MAX_FRET + 1) ** open.length;
  for (let n = 0; n < total; n++) {
    let rest = n;
    for (let s = open.length - 1; s >= 0; s--) {
      frets[s] = rest % (MAX_FRET + 1);
      rest = Math.floor(rest / (MAX_FRET + 1));
    }
    const cost = shapeCost(frets, open, chord);
    if (cost < bestCost) {
      bestCost = cost;
      best = [...frets];
    }
  }
  const shape = best ?? frets.map(() => 0);
  return shape.map((f, s) => midiToPitch((open[s] ?? 60) + f, chord.flats));
}

/** Pitches for a chord symbol on an instrument; undefined for an unknown symbol. */
export function voiceChord(symbol: string, tuning: readonly string[] | undefined): string[] | undefined {
  const chord = parseChord(symbol);
  if (chord === undefined) return undefined;
  return tuning === undefined ? stacked(chord) : fretted(chord, tuning);
}
