// Sheet music from a score: bars of notes and rests on a grid, ready to be written as MusicXML
// (musicxml.ts) and drawn by a player view. Built from the same expanded events the audio plays, at
// their written times (before humanize and strum looseness), so the music and the page agree.
//
// The score has no notation of its own, so this decides it: times are rounded to a grid of 32nd
// notes and triplets, a note without `len` is written up to the track's next note, a staff holds one
// voice (a held note is cut where the next one starts), and every rounding or cut that changes what
// was written is reported as a warning with the note's path.
import { spellChordTone } from "./chords.ts";
import { expandScore, type Issue, type NoteEvent } from "./events.ts";
import { barQuarters, DEFAULT_KEY, DEFAULT_METER, isCompound, parseKey, parseMeter, type KeySignature, type Meter } from "./meter.ts";
import { HOLD_SYLLABLE } from "./lyrics.ts";
import { PITCH_PATTERN, pitchToMidi } from "./pitch.ts";
import type { ScoreData } from "./score-schema.ts";
import { secondsToBeats } from "./time.ts";

/** Grid steps per quarter note: 32nd notes (3) and triplet 16ths (4) both fit. */
export const DIVISIONS = 24;
/** Keyboard instruments whose treble and bass tracks, side by side, share a grand staff. */
const KEYBOARDS: ReadonlySet<string> = new Set(["piano", "grandpiano", "organ"]);
/** A track whose pitches are mostly below this (A3) gets a bass clef. */
const BASS_BELOW = 57;
/** Rounding a time or a length by more than this many grid steps (a 48th of a beat) is reported; a triplet written as 0.333 is far inside it. */
const ROUNDING_WARNING = 0.5;

export type Clef = "treble" | "bass";

export interface NotationPitch {
  step: string;
  /** −1 flat, 0 natural, 1 sharp (±2 for doubles, in chords such as Cdim7). */
  alter: number;
  octave: number;
}

export type Accidental = "sharp" | "flat" | "natural" | "double-sharp" | "flat-flat";

const ACCIDENTALS: Record<number, Accidental> = { 2: "double-sharp", 1: "sharp", 0: "natural", [-1]: "flat", [-2]: "flat-flat" };

/** A note value as written: its shape, dots and whether it is one of a triplet. */
export interface NoteValue {
  type: "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd";
  dots: number;
  triplet: boolean;
}

export interface Lyric {
  text: string;
  syllabic: "single" | "begin" | "middle" | "end";
  /** The syllable is held over the notes that follow ("_"). */
  extend: boolean;
}

/** A note, a chord (several pitches) or a rest (none), within one bar. */
export interface NotationItem {
  /** Grid steps from the start of the score. */
  start: number;
  duration: number;
  pitches: NotationPitch[];
  /** Accidental to print per pitch (undefined: the key signature or the bar already says it). */
  accidentals: (Accidental | undefined)[];
  /** A whole-bar rest. */
  measureRest: boolean;
  value: NoteValue | undefined;
  tieStart: boolean;
  tieStop: boolean;
  /** Opens or closes a triplet bracket. */
  tuplet: "start" | "stop" | undefined;
  lyric: Lyric | undefined;
  /** A chord symbol printed above, where the harmony changes. */
  harmony: string | undefined;
}

export interface NotationMeasure {
  /** 0 for a pickup bar, then 1, 2 … */
  number: number;
  start: number;
  length: number;
  /** A pickup bar: shorter than the meter says. */
  implicit: boolean;
}

export interface NotationStaff {
  clef: Clef;
  /** Items per measure, in time order, filling each bar. */
  measures: NotationItem[][];
}

export interface NotationPart {
  id: string;
  name: string;
  /** The score tracks on this part's staves, one per staff. */
  tracks: number[];
  staves: NotationStaff[];
}

export interface Notation {
  title: string | undefined;
  composer: string | undefined;
  rights: string | undefined;
  tempo: number;
  meter: Meter;
  key: KeySignature;
  measures: NotationMeasure[];
  parts: NotationPart[];
  /** What the sheet music had to change from the score (rounded times, shortened notes). */
  warnings: Issue[];
}

/** One sounding note of a staff, before it is split into bars and note values. */
interface Written {
  start: number;
  end: number;
  pitches: NotationPitch[];
  lyric: Lyric | undefined;
  harmony: string | undefined;
  /** Where it came from, for warnings. */
  path: (string | number)[];
  /** Whether its end comes from its own `len` (not from the next note or the bar). */
  fromLen: boolean;
}

function notationPitch(name: string): NotationPitch | undefined {
  const match = PITCH_PATTERN.exec(name);
  if (!match) return undefined;
  const [, step = "C", accidental = "", octave = "4"] = match;
  return { step, alter: ALTER_OF[accidental] ?? 0, octave: Number(octave) };
}

const ALTER_OF: Record<string, number> = { "#": 1, b: -1, "": 0 };

const midiOf = (pitch: NotationPitch): number => (pitchToMidi(`${pitch.step}${pitch.octave}`) ?? 60) + pitch.alter;

/** The nearest grid point: a multiple of 3 (straight, down to 32nds) or of 4 (triplets), whichever is closer. */
export function snap(steps: number): number {
  const straight = Math.round(steps / 3) * 3;
  const triplet = Math.round(steps / 4) * 4;
  return Math.abs(triplet - steps) < Math.abs(straight - steps) - 1e-9 ? triplet : straight;
}

const beatsLabel = (steps: number): string => `${Math.round((steps / DIVISIONS) * 1000) / 1000}`;

interface TrackNotes {
  track: number;
  instrument: string;
  name: string;
  clef: Clef;
  notes: Written[];
}

function syllabicOf(joinsPrevious: boolean, joinsNext: boolean): Lyric["syllabic"] {
  if (joinsPrevious) return joinsNext ? "middle" : "end";
  return joinsNext ? "begin" : "single";
}

/** Syllables as MusicXML wants them: whether each joins the one before and after. */
function lyricsOf(events: readonly NoteEvent[]): Map<NoteEvent, Lyric> {
  const sung = events.filter((e) => e.lyric !== undefined);
  const lyrics = new Map<NoteEvent, Lyric>();
  let joinsPrevious = false;
  let previous: Lyric | undefined;
  for (const event of sung) {
    const raw = event.lyric ?? "";
    if (raw === HOLD_SYLLABLE) {
      if (previous) previous.extend = true;
      continue;
    }
    const joinsNext = raw.length > 1 && raw.endsWith("-");
    previous = { text: joinsNext ? raw.slice(0, -1) : raw, syllabic: syllabicOf(joinsPrevious, joinsNext), extend: false };
    lyrics.set(event, previous);
    joinsPrevious = joinsNext;
  }
  return lyrics;
}

function clefOf(pitches: readonly NotationPitch[]): Clef {
  const sorted = pitches.map(midiOf).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 60;
  return median < BASS_BELOW ? "bass" : "treble";
}

const toSteps = (beats: number): number => beats * DIVISIONS;

interface TrackContext {
  score: ScoreData;
  track: number;
  lyrics: Map<NoteEvent, Lyric>;
  warnings: Issue[];
}

/** One event as written: its rounded onset, its end from `len` (-1 when it has none), its pitches spelled. */
function writtenOf(event: NoteEvent, harmony: string | undefined, ctx: TrackContext): Written {
  const { score, track, warnings } = ctx;
  const exact = toSteps(secondsToBeats(event.nominal, score.tempo));
  const start = snap(exact);
  const path = ["tracks", track, "notes", event.note];
  if (Math.abs(start - exact) > ROUNDING_WARNING && event.repeat === 0) {
    warnings.push({
      path: [...path, "at"],
      message: `Starts at beat ${beatsLabel(exact)}, off the sheet-music grid; written at beat ${beatsLabel(start)}.`,
      hint: "Place notes on beats, halves, quarters, eighths of a beat or triplets for clean sheet music.",
    });
  }
  const len = score.tracks[track]?.notes[event.note]?.len;
  const beats = typeof len === "object" ? secondsToBeats(len.seconds, score.tempo) : len;
  const exactLen = beats === undefined ? 0 : toSteps(beats);
  if (Math.abs(snap(exactLen) - exactLen) > ROUNDING_WARNING && event.repeat === 0) {
    warnings.push({
      path: [...path, "len"],
      message: `Lasts ${beatsLabel(exactLen)} beats, off the sheet-music grid; written as ${beatsLabel(snap(exactLen))}.`,
      hint: "Give `len` in beats, halves, quarters, eighths of a beat or triplets (0.333) for clean sheet music.",
    });
  }
  const pitches = event.pitches
    .map(notationPitch)
    .filter((p) => p !== undefined)
    .map((p) => (event.chord === undefined ? p : (spellChordTone(event.chord, midiOf(p)) ?? p)));
  const end = beats === undefined ? -1 : start + snap(exactLen);
  return { start, end, pitches, lyric: ctx.lyrics.get(event), harmony, path, fromLen: beats !== undefined };
}

/** Events that start together become one chord, held as long as its longest note (a shorter `len` is warned). */
function merge(into: Written, other: Written, warnings: Issue[]): void {
  for (const pitch of other.pitches) if (!into.pitches.some((p) => midiOf(p) === midiOf(pitch))) into.pitches.push(pitch);
  if (into.fromLen && other.fromLen && into.end !== other.end) {
    const shorter = into.end < other.end ? into : other;
    warnings.push({
      path: [...shorter.path, "len"],
      message: `Starts with a longer note at beat ${beatsLabel(into.start)}; the sheet music writes them as one chord, held as long as the longer (one voice per staff).`,
      hint: "Give notes that start together the same `len`, or put the shorter one on a track of its own.",
    });
  }
  into.end = Math.max(into.end, other.end);
  into.fromLen ||= other.fromLen;
  into.lyric ??= other.lyric;
  into.harmony ??= other.harmony;
}

/** Ends each note: at its `len` but no later than the next onset (warned), else at the next onset or the end of its bar. */
function closeNotes(notes: Written[], barEnd: (steps: number) => number, warnings: Issue[]): void {
  notes.forEach((note, i) => {
    const next = notes[i + 1]?.start;
    if (note.end < 0) note.end = next ?? barEnd(note.start);
    else if (next !== undefined && note.end > next) {
      warnings.push({
        path: [...note.path, "len"],
        message: `Held past the next note at beat ${beatsLabel(next)}; the sheet music writes it shorter (one voice per staff).`,
        hint: "Shorten `len`, or put the held notes on a track of their own.",
      });
      note.end = next;
    }
    if (note.end <= note.start) note.end = note.start + 3;
    note.pitches.sort((a, b) => midiOf(a) - midiOf(b));
  });
}

/** A track's notes as written: rounded onsets, chords merged, lengths from `len` or the next onset. */
function trackNotes(score: ScoreData, track: number, events: readonly NoteEvent[], barEnd: (steps: number) => number, warnings: Issue[]): TrackNotes {
  const ctx: TrackContext = { score, track, lyrics: lyricsOf(events), warnings };
  const byStart = new Map<number, Written>();
  let lastHarmony: string | undefined;
  for (const event of events) {
    const harmony = event.chord !== undefined && event.chord !== lastHarmony ? event.chord : undefined;
    lastHarmony = event.chord ?? lastHarmony;
    const written = writtenOf(event, harmony, ctx);
    const existing = byStart.get(written.start);
    if (existing) merge(existing, written, warnings);
    else byStart.set(written.start, written);
  }
  const notes = [...byStart.values()].sort((a, b) => a.start - b.start);
  closeNotes(notes, barEnd, warnings);
  const scoreTrack = score.tracks[track];
  const name = scoreTrack?.name ?? scoreTrack?.instrument ?? "";
  return {
    track,
    instrument: scoreTrack?.instrument ?? "",
    name: name.charAt(0).toUpperCase() + name.slice(1),
    clef: scoreTrack?.clef ?? clefOf(notes.flatMap((n) => n.pitches)),
    notes,
  };
}

/** Bars from the pickup to the end of the last note. */
function measuresOf(pickup: number, bar: number, end: number): NotationMeasure[] {
  const measures: NotationMeasure[] = [];
  if (pickup > 0) measures.push({ number: 0, start: 0, length: pickup, implicit: true });
  for (let start = pickup, number = 1; start < end || measures.length === 0; start += bar, number++)
    measures.push({ number, start, length: bar, implicit: false });
  return measures;
}

/** Values a note may take outside a triplet, longest first, in grid steps. */
const STRAIGHT: readonly [number, NoteValue][] = [
  [96, { type: "whole", dots: 0, triplet: false }],
  [72, { type: "half", dots: 1, triplet: false }],
  [48, { type: "half", dots: 0, triplet: false }],
  [36, { type: "quarter", dots: 1, triplet: false }],
  [24, { type: "quarter", dots: 0, triplet: false }],
  [18, { type: "eighth", dots: 1, triplet: false }],
  [12, { type: "eighth", dots: 0, triplet: false }],
  [9, { type: "16th", dots: 1, triplet: false }],
  [6, { type: "16th", dots: 0, triplet: false }],
  [3, { type: "32nd", dots: 0, triplet: false }],
];
/** Values within a triplet quarter beat. */
const TRIPLET: readonly [number, NoteValue][] = [
  [16, { type: "quarter", dots: 0, triplet: true }],
  [8, { type: "eighth", dots: 0, triplet: true }],
  [4, { type: "16th", dots: 0, triplet: true }],
];

interface BeatGrid {
  /** Where the bar's beats are counted from (a pickup bar counts back from its end). */
  origin: number;
  beat: number;
  compound: boolean;
  /** Quarter notes (indexes from origin) written as triplets; empty in a meter that has none. */
  triplets: ReadonlySet<number>;
}

/** Triplets are written per quarter note. */
const TRIPLET_SPAN = DIVISIONS;

/**
 * Splits [start, end) — within one bar — into note values that show the beat: a value longer than
 * a beat starts on a beat (and in 6/8 lasts whole dotted beats); a shorter one stays inside its
 * beat; triplet beats use triplet values.
 */
function valuesOf(start: number, end: number, grid: BeatGrid, rest = false): { start: number; duration: number; value: NoteValue }[] {
  const pieces: { start: number; duration: number; value: NoteValue }[] = [];
  let at = start;
  while (at < end) {
    const position = at - grid.origin;
    const beatIndex = Math.floor(position / grid.beat);
    const span = Math.floor(position / TRIPLET_SPAN);
    // A straight value stays inside its beat and stops short of a triplet quarter within it.
    let beatEnd = grid.origin + (beatIndex + 1) * grid.beat;
    for (let q = span + 1; grid.origin + q * TRIPLET_SPAN < beatEnd; q++) if (grid.triplets.has(q)) beatEnd = grid.origin + q * TRIPLET_SPAN;
    const left = end - at;
    let chosen: [number, NoteValue] | undefined;
    if (grid.triplets.has(span)) {
      chosen = TRIPLET.find(([d]) => d <= Math.min(left, grid.origin + (span + 1) * TRIPLET_SPAN - at));
    } else {
      chosen = STRAIGHT.find(([d]) => {
        if (d > left) return false;
        // Longer than a beat: a note starts on a beat (in compound time it also lasts whole dotted
        // beats); a rest shows the bar's halves, so it starts on a multiple of itself.
        if (d > grid.beat) return rest ? position % d === 0 : position % grid.beat === 0 && (!grid.compound || d % grid.beat === 0);
        return at + d <= beatEnd;
      });
    }
    // Times are on the grid (onGrid), so a remainder is at least a 32nd.
    const [duration, value] = chosen ?? [3, { type: "32nd", dots: 0, triplet: false }];
    pieces.push({ start: at, duration, value });
    at += duration;
  }
  return pieces;
}

const tripletBoundary = (steps: number): boolean => steps % 3 !== 0;

/** Whether the meter writes triplets: where its beat is whole quarter notes (2/4, 3/4, 4/4, 2/2), not in 6/8 or 3/8. */
const hasTriplets = (meter: Meter, beat: number): boolean => !isCompound(meter) && beat % TRIPLET_SPAN === 0;

/** The pickup in grid steps, on a grid its meter can write (no triplet lengths in 6/8); any rounding is reported. */
function pickupSteps(beats: number, meter: Meter, warnings: Issue[]): number {
  const exact = toSteps(beats);
  const snapped = snap(exact);
  const straight = hasTriplets(meter, beatOf(meter)) || snapped % 3 === 0;
  const written = straight ? snapped : Math.max(3, Math.round(snapped / 3) * 3);
  if (Math.abs(written - exact) > ROUNDING_WARNING) {
    const why = straight ? "off the sheet-music grid" : `a triplet length, and ${meter.beats}/${meter.beatType} writes no triplets`;
    warnings.push({
      path: ["pickup"],
      message: `A pickup of ${beatsLabel(exact)} beats is ${why}; written as ${beatsLabel(written)}, which moves every bar line.`,
      hint: "Give the pickup in whole beats, eighths (0.5) or sixteenths (0.25) of a beat.",
    });
  }
  return written;
}

const beatOf = (meter: Meter): number => (isCompound(meter) ? (DIVISIONS * 4 * 3) / meter.beatType : (DIVISIONS * 4) / meter.beatType);

/** Quarter notes of a bar whose notes fall on the triplet grid; times in them are moved onto it. */
function beatGrid(measure: NotationMeasure, meter: Meter, bar: number, boundaries: number[]): BeatGrid {
  const compound = isCompound(meter);
  const beat = beatOf(meter);
  const origin = measure.implicit ? measure.start + measure.length - bar : measure.start;
  const triplets = new Set<number>();
  // Elsewhere the quarter note is not a unit of the beat, so triplet times go onto the straight grid.
  if (hasTriplets(meter, beat)) {
    // The bar's own start counts: a pickup of a triplet's length starts off the straight grid.
    for (const b of [measure.start, ...boundaries])
      if (b >= measure.start && b < measure.start + measure.length && tripletBoundary(b - origin)) triplets.add(Math.floor((b - origin) / TRIPLET_SPAN));
    // A quarter the bar line cuts (a pickup of 0.25 next to triplets) is written in triplets only
    // when the bar line is on their grid; else straight, where every bar line is.
    const start = Math.floor((measure.start - origin) / TRIPLET_SPAN);
    if ((measure.start - origin) % 4 !== 0) triplets.delete(start);
  }
  return { origin, beat, compound, triplets };
}

/** Moves a time onto what the bar can write: the triplet grid in a triplet quarter, else the straight one (32nds). */
function onGrid(steps: number, grid: BeatGrid): number {
  const span = Math.floor((steps - grid.origin) / TRIPLET_SPAN);
  const spanStart = grid.origin + span * TRIPLET_SPAN;
  const unit = grid.triplets.has(span) ? 4 : 3;
  return spanStart + Math.round((steps - spanStart) / unit) * unit;
}

function itemOf(start: number, duration: number, value: NoteValue | undefined, pitches: NotationPitch[]): NotationItem {
  return {
    start,
    duration,
    pitches,
    accidentals: pitches.map(() => undefined),
    measureRest: false,
    value,
    tieStart: false,
    tieStop: false,
    tuplet: undefined,
    lyric: undefined,
    harmony: undefined,
  };
}

/** One bar of a staff: its notes (clipped to the bar), the rests between them, as note values. */
function measureItems(notes: readonly Written[], measure: NotationMeasure, grid: BeatGrid, warnings: Issue[]): NotationItem[] {
  const barStart = measure.start;
  const barEnd = measure.start + measure.length;
  const inBar = notes.filter((n) => n.start < barEnd && n.end > barStart);
  if (inBar.length === 0 && !measure.implicit) return [{ ...itemOf(barStart, measure.length, undefined, []), measureRest: true }];
  const items: NotationItem[] = [];
  let at = barStart;
  const pushRest = (until: number): void => {
    for (const piece of valuesOf(at, until, grid, true)) items.push(itemOf(piece.start, piece.duration, piece.value, []));
  };
  const moved = (field: "at" | "len", note: Written, exact: number, written: number): void => {
    if (written === exact) return;
    const mixed = grid.triplets.has(Math.floor((exact - grid.origin) / TRIPLET_SPAN));
    const why = mixed ? "in a quarter note that also has triplets" : "a triplet time, and this meter writes no triplets";
    warnings.push({
      path: [...note.path, field],
      message: `${field === "at" ? "Starts" : "Ends"} at beat ${beatsLabel(exact)}, ${why}; written at beat ${beatsLabel(written)}.`,
      hint: mixed
        ? "Keep one subdivision per quarter note: straight (0.5, 0.25) or triplets (0.333), not both."
        : "Triplets are written only where the beat is whole quarter notes (2/4, 3/4, 4/4, 2/2). In 6/8 or 3/8, use eighths (0.5) and sixteenths (0.25).",
    });
  };
  for (const note of inBar) {
    const start = onGrid(note.start, grid);
    const end = onGrid(note.end, grid);
    if (note.start >= barStart) moved("at", note, note.start, start);
    if (note.fromLen && note.end <= barEnd) moved("len", note, note.end, end);
    // Never back over what is written: rounding may move a start before the last note's end.
    const from = Math.max(barStart, at, start);
    const to = Math.min(barEnd, end);
    if (to <= from) continue;
    if (from > at) pushRest(from);
    const pieces = valuesOf(from, to, grid);
    pieces.forEach((piece, i) => {
      const item = itemOf(
        piece.start,
        piece.duration,
        piece.value,
        note.pitches.map((p) => ({ ...p })),
      );
      item.tieStop = i > 0 || note.start < barStart;
      item.tieStart = i < pieces.length - 1 || note.end > barEnd;
      if (i === 0 && note.start >= barStart) {
        item.lyric = note.lyric;
        item.harmony = note.harmony;
      }
      items.push(item);
    });
    at = to;
  }
  if (at < barEnd) pushRest(barEnd);
  markTuplets(items, grid);
  return items;
}

/** Brackets each triplet quarter: the first item in it opens, the last closes. */
function markTuplets(items: NotationItem[], grid: BeatGrid): void {
  for (const span of grid.triplets) {
    const inBeat = items.filter((item) => item.value?.triplet && Math.floor((item.start - grid.origin) / TRIPLET_SPAN) === span);
    const first = inBeat[0];
    const last = inBeat.at(-1);
    if (first === undefined || last === undefined || first === last) continue;
    first.tuplet = "start";
    last.tuplet = "stop";
  }
}

/** Steps (C D E …) the key signature alters, and how. */
function signatureAlters(key: KeySignature): Map<string, number> {
  const sharps = ["F", "C", "G", "D", "A", "E", "B"];
  const alters = new Map<string, number>();
  if (key.fifths > 0) for (const step of sharps.slice(0, key.fifths)) alters.set(step, 1);
  if (key.fifths < 0) for (const step of [...sharps].reverse().slice(0, -key.fifths)) alters.set(step, -1);
  return alters;
}

/** Prints an accidental where the key signature and the bar so far do not already give the pitch. */
function markAccidentals(items: NotationItem[], key: KeySignature): void {
  const signature = signatureAlters(key);
  const inBar = new Map<string, number>();
  for (const item of items) {
    item.pitches.forEach((pitch, i) => {
      const line = `${pitch.step}${pitch.octave}`;
      const current = inBar.get(line) ?? signature.get(pitch.step) ?? 0;
      // A note tied over from the bar before carries its pitch without stating it, so a later note still needs the accidental.
      if (item.tieStop) return;
      if (current !== pitch.alter) item.accidentals[i] = ACCIDENTALS[pitch.alter];
      inBar.set(line, pitch.alter);
    });
  }
}

/** What every staff of the score shares: its bars, meter and key, and where warnings go. */
interface Sheet {
  measures: readonly NotationMeasure[];
  meter: Meter;
  bar: number;
  key: KeySignature;
  warnings: Issue[];
}

function staffOf(notes: readonly Written[], clef: Clef, sheet: Sheet): NotationStaff {
  const { measures, meter, bar, key, warnings } = sheet;
  const boundaries = notes.flatMap((n) => [n.start, n.end]);
  return {
    clef,
    measures: measures.map((measure) => {
      const items = measureItems(notes, measure, beatGrid(measure, meter, bar, boundaries), warnings);
      markAccidentals(items, key);
      return items;
    }),
  };
}

/** Tracks shown on sheet music: a pitched instrument (built in or the score's own) with notes, not hidden. A sound effect that takes a pitch (a laser's start) is not music. */
function shownTracks(score: ScoreData, expanded: ReturnType<typeof expandScore>): number[] {
  const withPitches = new Set(expanded.events.filter((e) => e.pitches.length > 0).map((e) => e.track));
  const pitched = (instrument: string): boolean => expanded.instruments.get(instrument)?.descriptor.pitched === true;
  return score.tracks.flatMap((track, i) => (track.notation !== false && withPitches.has(i) && pitched(track.instrument) ? [i] : []));
}

/**
 * Sheet music for a valid score, or undefined when it has nothing to show (only sound effects, or
 * every track hidden). Rounding and cutting are reported in `warnings`.
 */
export function scoreToNotation(score: ScoreData): Notation | undefined {
  const expanded = expandScore(score);
  const meter = parseMeter(score.meter ?? DEFAULT_METER) ?? { beats: 4, beatType: 4 };
  const key = parseKey(score.key ?? DEFAULT_KEY) ?? { fifths: 0, mode: "major" };
  const bar = barQuarters(meter) * DIVISIONS;
  const warnings: Issue[] = [];
  const pickup = pickupSteps(score.pickup ?? 0, meter, warnings);
  const barEnd = (steps: number): number => (steps < pickup ? pickup : pickup + (Math.floor((steps - pickup) / bar) + 1) * bar);
  const shown = shownTracks(score, expanded);
  if (shown.length === 0) return undefined;
  const tracks = shown.map((track) =>
    trackNotes(
      score,
      track,
      // In written order: humanize may swap neighbours in playback order, and lyrics join by order.
      expanded.events.filter((e) => e.track === track && e.pitches.length > 0).sort((a, b) => a.nominal - b.nominal),
      barEnd,
      warnings,
    ),
  );
  const end = Math.max(...tracks.flatMap((t) => t.notes.map((n) => n.end)));
  const measures = measuresOf(pickup, bar, end);
  const sheet: Sheet = { measures, meter, bar, key, warnings };
  const parts: NotationPart[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const upper = tracks[i];
    if (upper === undefined) continue;
    const lower = tracks[i + 1];
    const grand =
      lower !== undefined && KEYBOARDS.has(upper.instrument) && lower.instrument === upper.instrument && upper.clef === "treble" && lower.clef === "bass";
    const members = grand ? [upper, lower] : [upper];
    parts.push({
      id: `P${parts.length + 1}`,
      name: grand ? "Piano" : upper.name,
      tracks: members.map((t) => t.track),
      staves: members.map((t) => staffOf(t.notes, t.clef, sheet)),
    });
    if (grand) i++;
  }
  // A repeated note warns once, for its first repetition, not once per repetition (the hint names the kind).
  const unique = [...new Map(warnings.map((w) => [`${w.path.join(".")} ${w.hint ?? w.message}`, w])).values()];
  return { title: score.title, composer: score.author, rights: score.copyright, tempo: score.tempo, meter, key, measures, parts, warnings: unique };
}
