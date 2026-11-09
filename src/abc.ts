// YuE2's native ABC (two monophonic voices, `Vocal` and `Ins`, quoted chord symbols) → a
// JingleScript score. This is the bounded dialect YuE2's plan() writes and its own abc_tools.py reads
// (YuE skills/yue2-music/references/abc-editing.md): L:1/2^n, integer duration multipliers, ties,
// `z` rests, `Z` whole-bar rests, `% section` comments, inline [K:...]. Accidentals carry through the
// bar BY LETTER across octaves (the native convention). Anything else is an AbcError naming the line,
// never a guess.
import { CHORD_PATTERN } from "./chords.ts";
import { descriptorOf, isInstrumentName } from "./instruments/index.ts";
import { barQuarters, parseKey, parseMeter, type Meter } from "./meter.ts";
import { PITCH_PATTERN, pitchToMidi } from "./pitch.ts";
import { FORMAT } from "./score-schema.ts";
import { parseScore, type Score } from "./score.ts";

export class AbcError extends Error {
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `ABC line ${line}: ${message}`);
    this.name = "AbcError";
  }
}

export interface AbcNote {
  /** Quarter notes from the start. */
  at: number;
  /** Quarter notes it sounds, ties merged. */
  len: number;
  midi: number;
  /** Spelled as written, e.g. "F#4", "Bb3" (double accidentals respelled). */
  pitch: string;
  /** A mora to sing on it (set by fitLyrics; YuE2's ABC has none). */
  lyric?: string;
  /** The last note of a lyric line. */
  lineEnd?: boolean;
}

export interface AbcChord {
  at: number;
  /** The symbol as written, e.g. "F#m7/C#". */
  symbol: string;
}

export interface AbcSection {
  at: number;
  /** The comment's text, e.g. "verse". */
  label: string;
}

export interface ParsedAbc {
  title?: string;
  /** Quarter notes per minute. */
  tempo: number;
  meter: string;
  /** JingleScript key ("G", "F#m"), from the first K: field. */
  key: string;
  voices: Record<string, AbcNote[]>;
  chords: AbcChord[];
  sections: AbcSection[];
  /** Quarter notes up to the end of the longest voice. */
  length: number;
  /** Quarter notes before the first bar line (a pickup kept by sliceSection). */
  pickup?: number;
}

const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ACCIDENTALS: Record<string, number> = { "^^": 2, "^": 1, __: -2, _: -1, "=": 0 };
const SPELLED_SHIFT: Record<string, number> = { "##": 2, "#": 1, bb: -2, b: -1, "": 0 };
const MAJOR_MODES = new Set(["", "maj", "major"]);
const MINOR_MODES = new Set(["m", "min", "minor"]);

interface KeyState {
  name: string;
  /** Semitone shift per letter from the signature. */
  signature: Record<string, number>;
  flats: boolean;
}

function parseAbcKey(field: string, line: number): KeyState {
  const text = field.trim();
  const tonic = /^[A-G][#b]?/.exec(text)?.[0] ?? "";
  const mode = text.slice(tonic.length).trim().toLowerCase();
  const minor = MINOR_MODES.has(mode);
  if (tonic === "" || (!minor && !MAJOR_MODES.has(mode))) {
    throw new AbcError(`unsupported key "${field}" (major or minor keys such as K:G, K:Bb, K:F#m only)`, line);
  }
  const name = tonic + (minor ? "m" : "");
  const sig = parseKey(name);
  if (sig === undefined) throw new AbcError(`key "${field}" needs more than seven sharps or flats`, line);
  const signature: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const order = sig.fifths >= 0 ? "FCGDAEB" : "BEADGCF";
  for (const letter of order.slice(0, Math.abs(sig.fifths))) signature[letter] = Math.sign(sig.fifths);
  return { name, signature, flats: sig.fifths < 0 };
}

function parseUnit(field: string, line: number): number {
  const [one, den = ""] = field.trim().split("/");
  const n = Number(den);
  if (one !== "1" || !Number.isInteger(n) || n < 1 || n > 1024 || (n & (n - 1)) !== 0) {
    throw new AbcError(`unsupported L:${field} (1/1 … 1/1024 only)`, line);
  }
  return 4 / n;
}

function parseTempo(field: string, line: number): number {
  const parts = field.split("=").map((part) => part.trim());
  const value = Number(parts.at(-1));
  const [num, den] = parts.length === 2 ? (parts[0] ?? "").split("/").map(Number) : [1, 4];
  if (parts.length > 2 || !Number.isFinite(value) || value <= 0 || !(num && den)) throw new AbcError(`unsupported Q:${field} (write Q:1/4=120)`, line);
  return value * ((4 * num) / den);
}

function parseAbcMeter(field: string, line: number): { text: string; meter: Meter } {
  const named: Record<string, string> = { C: "4/4", "C|": "2/2" };
  const text = named[field.trim()] ?? field.trim();
  const meter = parseMeter(text);
  if (meter === undefined) throw new AbcError(`unsupported meter M:${field}`, line);
  return { text, meter };
}

function pcName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12] ?? "C";
}

function spell(letter: string, shift: number, octave: number, flats: boolean): { pitch: string; midi: number } {
  const midi = 12 * (octave + 1) + (LETTER_SEMITONE[letter] ?? 0) + shift;
  const written: Record<number, string> = { [-1]: "b", 0: "", 1: "#" };
  const sign = written[shift];
  if (sign !== undefined) return { pitch: `${letter}${sign}${octave}`, midi };
  return { pitch: `${pcName(midi, flats)}${Math.floor(midi / 12) - 1}`, midi };
}

interface VoiceState {
  time: number;
  barStart: number;
  /** Explicit accidentals in this bar, by letter. */
  accidentals: Record<string, number>;
  notes: AbcNote[];
  /** The last note was followed by "-": the next note continues it. */
  tie?: AbcNote;
}

interface WrittenPitch {
  letter: string;
  octave: number;
  explicit?: number;
}

class AbcReader {
  title?: string;
  unit = 4 / 8;
  tempo = 120;
  meter = parseAbcMeter("4/4", 0);
  key?: KeyState;
  firstKey?: string;
  readonly voices = new Map<string, VoiceState>();
  readonly chords: AbcChord[] = [];
  readonly sections: AbcSection[] = [];
  current?: VoiceState;
  pendingSection?: string;
  inBody = false;
  line = 0;
  body = "";
  i = 0;

  read(text: string): ParsedAbc {
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      this.line = index + 1;
      this.readLine(raw.trim());
    }
    if (this.firstKey === undefined) throw new AbcError("no K: field");
    const voices: Record<string, AbcNote[]> = {};
    for (const [name, state] of this.voices) voices[name] = state.notes;
    const length = Math.max(0, ...[...this.voices.values()].map((state) => state.time));
    const chords = dedupeChords(this.chords.toSorted((a, b) => a.at - b.at));
    return { title: this.title, tempo: this.tempo, meter: this.meter.text, key: this.firstKey, voices, chords, sections: this.sections, length };
  }

  fail(message: string): never {
    throw new AbcError(message, this.line);
  }

  voice(name: string): VoiceState {
    let state = this.voices.get(name);
    if (state === undefined) {
      state = { time: 0, barStart: 0, accidentals: {}, notes: [] };
      this.voices.set(name, state);
    }
    return state;
  }

  setKey(field: string): void {
    this.key = parseAbcKey(field, this.line);
    this.firstKey ??= this.key.name;
    for (const state of this.voices.values()) state.accidentals = {};
  }

  readLine(text: string): void {
    if (text === "") return;
    if (text.startsWith("%")) {
      const label = text.replace(/^%+/, "").trim();
      if (this.inBody && label !== "") this.pendingSection = label;
      return;
    }
    if (/^[A-Za-z]:/.test(text)) {
      this.readField(text[0] ?? "", text.slice(2).trim());
      return;
    }
    if (this.key === undefined) this.fail("music before the K: field");
    this.current ??= this.voice("Vocal");
    this.readMusic(text);
  }

  /** A score has one tempo: a Q: that changes it once the music has begun would retime what came before. */
  setTempo(tempo: number): void {
    const begun = [...this.voices.values()].some((voice) => voice.time > 0) || this.chords.length > 0;
    if (begun && tempo !== this.tempo) {
      this.fail(`a tempo change in the music (Q: to ${tempo} after ${this.tempo}) is not supported: a score has one tempo`);
    }
    this.tempo = tempo;
  }

  readField(name: string, value: string): void {
    const fields: Record<string, () => void> = {
      X: () => undefined,
      T: () => {
        if (value !== "") this.title ??= value;
      },
      L: () => (this.unit = parseUnit(value, this.line)),
      Q: () => this.setTempo(parseTempo(value, this.line)),
      M: () => (this.meter = parseAbcMeter(value, this.line)),
      K: () => {
        this.setKey(value);
        this.inBody = true;
      },
      V: () => this.switchVoice(value),
      w: () => this.fail("lyric lines (w:) are not part of YuE2's dialect"),
    };
    // Other fields (C:, R:, N: …) carry nothing we play.
    fields[name]?.();
  }

  switchVoice(value: string): void {
    const name = value.split(/\s/)[0] ?? "";
    if (name === "") this.fail("V: needs a voice name");
    // Header V: lines declare voices; body ones switch to them.
    this.current = this.voice(name);
    if (this.inBody && this.pendingSection !== undefined) {
      this.sections.push({ at: this.current.time, label: this.pendingSection });
      this.pendingSection = undefined;
    }
  }

  readMusic(body: string): void {
    this.body = body;
    this.i = 0;
    while (this.i < body.length) this.readToken(body[this.i] ?? "");
  }

  readToken(ch: string): void {
    if (ch === " " || ch === "\t" || ch === "\\") this.i += 1;
    else if (ch === "|") this.readBarLine();
    else if (ch === "[") this.readInlineField();
    else if (ch === '"') this.readChordSymbol();
    else if (ch === "z" || ch === "x") this.readRest();
    else if (ch === "Z" || ch === "X") this.readBarRest();
    else if (/[\^_=A-Ga-g]/.test(ch)) this.readNote();
    else this.fail(`"${ch}" is not part of YuE2's ABC dialect (tuplets, grace notes, slurs, decorations and broken rhythms are not)`);
  }

  get state(): VoiceState {
    return this.current ?? this.fail("music before a voice");
  }

  readDuration(): number {
    const digits = /^\d+/.exec(this.body.slice(this.i))?.[0];
    if (digits !== undefined) {
      this.i += digits.length;
      return Number(digits);
    }
    if (this.body[this.i] === "/") this.fail("fractional durations (C/2) are not part of YuE2's dialect");
    return 1;
  }

  readBarLine(): void {
    if (this.body[this.i + 1] === ":" || this.body[this.i - 1] === ":") this.fail("repeat signs are not supported");
    while (this.body[this.i] === "|" || this.body[this.i] === "]") this.i += 1;
    const state = this.state;
    state.barStart = state.time;
    state.accidentals = {};
  }

  readInlineField(): void {
    const inline = /^\[([KLMQ]):([^\]]*)\]/.exec(this.body.slice(this.i));
    if (!inline) this.fail("chords in brackets ([CEG]) and other [ ] forms are not part of YuE2's dialect");
    const [whole, name = "", value = ""] = inline;
    this.readField(name, value.trim());
    this.i += whole.length;
  }

  readChordSymbol(): void {
    const close = this.body.indexOf('"', this.i + 1);
    if (close < 0) this.fail("unclosed chord symbol");
    const symbol = this.body.slice(this.i + 1, close).trim();
    if (symbol !== "") this.chords.push({ at: this.state.time, symbol });
    this.i = close + 1;
  }

  readRest(): void {
    this.i += 1;
    const state = this.state;
    state.time += this.readDuration() * this.unit;
    state.tie = undefined;
  }

  readBarRest(): void {
    this.i += 1;
    const state = this.state;
    // A whole-bar rest stands for complete bars.
    state.time = state.barStart + this.readDuration() * barQuarters(this.meter.meter);
    state.barStart = state.time;
    state.tie = undefined;
  }

  readPitch(): WrittenPitch {
    const two = this.body.slice(this.i, this.i + 2);
    const one = two[0] ?? "";
    let acc = "";
    if (ACCIDENTALS[two] !== undefined) acc = two;
    else if (ACCIDENTALS[one] !== undefined) acc = one;
    this.i += acc.length;
    const raw = this.body[this.i] ?? "";
    if (!/[A-Ga-g]/.test(raw)) this.fail(`expected a note after "${acc}"`);
    this.i += 1;
    const letter = raw.toUpperCase();
    let octave = raw === letter ? 4 : 5;
    for (let mark = this.body[this.i]; mark === "'" || mark === ","; mark = this.body[this.i]) {
      octave += mark === "'" ? 1 : -1;
      this.i += 1;
    }
    return { letter, octave, explicit: ACCIDENTALS[acc] };
  }

  readNote(): void {
    const state = this.state;
    const written = this.readPitch();
    const len = this.readDuration() * this.unit;
    const { letter, octave, explicit } = written;
    if (explicit !== undefined) state.accidentals[letter] = explicit;
    const tied = state.tie;
    const natural = 12 * (octave + 1) + (LETTER_SEMITONE[letter] ?? 0);
    let shift = explicit ?? state.accidentals[letter] ?? this.key?.signature[letter] ?? 0;
    // An unmarked continuation of a tie keeps the tied note's pitch (across a bar line too).
    if (tied?.pitch[0] === letter && explicit === undefined && Math.abs(tied.midi - natural) <= 2) shift = tied.midi - natural;
    const { pitch, midi } = spell(letter, shift, octave, this.key?.flats ?? false);
    if (tied === undefined) {
      const note = { at: state.time, len, midi, pitch };
      state.notes.push(note);
      state.tie = note;
    } else {
      if (tied.midi !== midi) this.fail(`a tie joins ${tied.pitch} to a different pitch, ${pitch}`);
      tied.len += len;
    }
    state.time += len;
    if (this.body[this.i] === "-") this.i += 1;
    else state.tie = undefined;
  }
}

/** Parses YuE2's native ABC. Throws AbcError naming the line for anything outside the dialect. */
export function parseAbc(text: string): ParsedAbc {
  return new AbcReader().read(text);
}

function dedupeChords(chords: AbcChord[]): AbcChord[] {
  const out: AbcChord[] = [];
  for (const chord of chords) {
    const last = out.at(-1);
    if (last !== undefined && last.at === chord.at) out[out.length - 1] = chord;
    else if (last?.symbol !== chord.symbol) out.push(chord);
  }
  return out;
}

// YuE2 chord qualities JingleScript has no name for, as intervals above the root.
const EXTRA_QUALITIES: Record<string, readonly number[]> = {
  m7b5: [0, 3, 6, 10],
  "7sus4": [0, 5, 7, 10],
  "m(maj7)": [0, 3, 7, 11],
};

/** "F#" → 6; undefined when it is not a note name. */
function noteClass(name: string): number | undefined {
  const base = LETTER_SEMITONE[name[0] ?? ""];
  const shift = SPELLED_SHIFT[name.slice(1)];
  return base === undefined || shift === undefined ? undefined : (((base + shift) % 12) + 12) % 12;
}

/** Splits "F#m7/C#" into its root, quality and slash bass. */
function splitChord(symbol: string): { root: string; quality: string; slash?: string } {
  const slashAt = symbol.lastIndexOf("/");
  const slash = slashAt > 0 && noteClass(symbol.slice(slashAt + 1)) !== undefined ? symbol.slice(slashAt + 1) : undefined;
  const head = slash === undefined ? symbol : symbol.slice(0, slashAt);
  let rootLength = 1;
  while (rootLength < 3 && noteClass(head.slice(0, rootLength + 1)) !== undefined) rootLength += 1;
  return { root: head.slice(0, rootLength), quality: head.slice(rootLength), slash };
}

export interface ChordVoicing {
  /** A JingleScript chord name, when there is one. */
  chord?: string;
  /** Otherwise explicit pitches in root position from octave 4. */
  pitches?: string[];
  /** Bass pitch: the root, or the slash bass, between E2 and D#3. */
  bass: string;
}

/** A YuE2 chord symbol as JingleScript plays it. Throws for symbols outside YuE2's vocabulary. */
export function voiceChord(symbol: string, flatsHint: boolean): ChordVoicing {
  const { root, quality, slash } = splitChord(symbol);
  const rootPc = noteClass(root);
  if (rootPc === undefined) throw new AbcError(`unsupported chord symbol "${symbol}"`);
  const flats = root.slice(1).includes("b") || (!root.includes("#") && flatsHint);
  const bassPc = noteClass(slash ?? root) ?? rootPc;
  const bass = `${pcName(bassPc, flats)}${bassPc >= 4 ? 2 : 3}`;
  const plainRoot = root.length <= 2 ? root : pcName(rootPc, flats);
  if (CHORD_PATTERN.test(plainRoot + quality)) return { chord: plainRoot + quality, bass };
  const intervals = EXTRA_QUALITIES[quality];
  if (intervals === undefined) throw new AbcError(`unsupported chord quality in "${symbol}"`);
  const pitches = intervals.map((step) => `${pcName(rootPc + step, flats)}${4 + Math.floor((rootPc + step) / 12)}`);
  return { pitches, bass };
}

export interface AbcToScoreOptions {
  /** Instrument for the Vocal voice (default "marimba"). */
  melody?: string;
  /** Instrument for the Ins voice (default "vibraphone"). */
  ins?: string;
  /** Instrument for the chord symbols (default "grandpiano"); false leaves them out. */
  chords?: string | false;
  /** Instrument for a bass line on the chord roots (default "grandpiano"); false leaves it out. */
  bass?: string | false;
  /**
   * Keep only this section, moved to beat 0: its cue name ("chorus", "chorus_2" for the second
   * chorus). YuE2 plans whole songs; a jingle is usually one section of one.
   */
  section?: string;
  /**
   * Sing the Vocal line with NEUTRINO (its notes need lyrics: run fitLyrics first). The line is
   * moved by octaves to sit around A4, and a bar is added before it when it would start too soon.
   */
  sing?: { voice?: string; level?: number };
  title?: string;
  seed?: number;
  /** Beats after the last bar for the sound to ring out (default 2). */
  tail?: number;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Cue names of the sections in order: "chorus", then "chorus_2" for the second, and so on. */
export function sectionNames(parsed: ParsedAbc): string[] {
  const taken = new Set<string>();
  return parsed.sections.map((section) => cueName(section.label, taken));
}

/** The ABC cut down to one section (by its cue name), starting at beat 0. */
export function sliceSection(parsed: ParsedAbc, name: string): ParsedAbc {
  const names = sectionNames(parsed);
  const index = names.indexOf(name);
  const section = parsed.sections[index];
  if (section === undefined) {
    throw new AbcError(names.length === 0 ? "the ABC has no sections (% comments)" : `no section "${name}"; sections: ${names.join(", ")}`);
  }
  const end = parsed.sections[index + 1]?.at ?? parsed.length;
  // Notes of the Vocal line that run without a rest into the section are its pickup.
  const start = section.at - pickupBefore(parsed.voices.Vocal ?? [], section.at);
  const voices: Record<string, AbcNote[]> = {};
  for (const [voice, notes] of Object.entries(parsed.voices)) {
    // A note tied in from before the section sounds from its start: it is kept, cut to begin there —
    // unless it carries a word: then it ends the phrase before (YuE2 holds a line's last mora over
    // into the next section), and singing it again would put a stray syllable at the start.
    voices[voice] = notes
      .filter((note) => note.at < end && (note.at >= start || (note.lyric === undefined && note.at + note.len > start + 1e-9)))
      .map((note) => {
        const at = Math.max(note.at, start);
        return { ...note, at: at - start, len: Math.min(note.at + note.len, end) - at };
      });
  }
  // The chord sounding when the section starts is carried in at beat 0.
  const sounding = parsed.chords.filter((chord) => chord.at <= start).at(-1);
  const inside = parsed.chords.filter((chord) => chord.at > start && chord.at < end);
  const chords = [...(sounding === undefined ? [] : [sounding]), ...inside].map((chord) => ({ ...chord, at: Math.max(0, chord.at - start) }));
  const pickup = section.at - start;
  return { ...parsed, voices, chords, sections: [{ at: pickup, label: section.label }], length: end - start, ...(pickup > 0 ? { pickup } : {}) };
}

/** Beats of notes running, with no rest, into a note at `at` (less than one bar's worth is a pickup). */
function pickupBefore(notes: AbcNote[], at: number): number {
  if (!notes.some((note) => Math.abs(note.at - at) < 1e-9)) return 0;
  let from = at;
  for (const note of notes.filter((n) => n.at < at).reverse()) {
    if (Math.abs(note.at + note.len - from) > 1e-9) break;
    from = note.at;
  }
  return at - from < 4 ? at - from : 0;
}

/** Everything moved later by `beats`; the first chord is carried back to 0. */
function delay(parsed: ParsedAbc, beats: number): ParsedAbc {
  const voices: Record<string, AbcNote[]> = {};
  for (const [name, notes] of Object.entries(parsed.voices)) voices[name] = notes.map((note) => ({ ...note, at: note.at + beats }));
  const chords = parsed.chords.map((chord, i) => ({ ...chord, at: i === 0 ? 0 : chord.at + beats }));
  const sections = parsed.sections.map((section) => ({ ...section, at: section.at + beats }));
  return { ...parsed, voices, chords, sections, length: parsed.length + beats };
}

/** Pitches moved by octaves into the instrument's range: the whole line if it fits, else note by note. */
function fitRange<T extends { pitch: string }>(notes: T[], instrument: string): T[] {
  const range = isInstrumentName(instrument) ? descriptorOf(instrument).range : null;
  if (range === null || notes.length === 0) return notes;
  const low = pitchToMidi(range.low) ?? 0;
  const high = pitchToMidi(range.high) ?? 127;
  const midis = notes.map((note) => pitchToMidi(note.pitch) ?? 60);
  const fits = (shift: number): boolean => midis.every((midi) => midi + 12 * shift >= low && midi + 12 * shift <= high);
  const whole = [0, -1, 1, -2, 2, -3, 3].find(fits);
  return notes.map((note, i) => {
    const midi = midis[i] ?? 60;
    let shift = whole ?? 0;
    if (whole === undefined) {
      while (midi + 12 * shift > high && midi + 12 * (shift - 1) >= low) shift -= 1;
      while (midi + 12 * shift < low && midi + 12 * (shift + 1) <= high) shift += 1;
    }
    return shift === 0 ? note : { ...note, pitch: moveOctaves(note.pitch, shift) };
  });
}

/** Octaves that put the line's median pitch in D#4–D5 (around A4), where NEUTRINO's voices sing. */
function singingShift(notes: AbcNote[]): number {
  const midis = notes.map((note) => note.midi).toSorted((a, b) => a - b);
  const median = midis[Math.floor(midis.length / 2)] ?? 69;
  return Math.round((69 - median) / 12);
}

function moveOctaves(pitch: string, shift: number): string {
  const match = PITCH_PATTERN.exec(pitch);
  return match ? `${match[1] ?? ""}${match[2] ?? ""}${Number(match[3]) + shift}` : pitch;
}

function cueName(label: string, taken: Set<string>): string {
  const base = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== "")
    .join("_");
  const name = /^[a-z]/.test(base) ? base : `section_${base}`;
  let unique = name;
  let n = 1;
  while (taken.has(unique)) {
    n += 1;
    unique = `${name}_${n}`;
  }
  taken.add(unique);
  return unique;
}

interface ChordSpan extends AbcChord {
  len: number;
  voicing: ChordVoicing;
}

function melodyTracks(parsed: ParsedAbc, options: AbcToScoreOptions): unknown[] {
  return Object.entries(parsed.voices)
    .filter(([, notes]) => notes.length > 0)
    .map(([name, notes]) => {
      const instrument = name === "Vocal" ? (options.melody ?? "marimba") : (options.ins ?? "vibraphone");
      const sung = name === "Vocal" && options.sing !== undefined;
      const shift = sung ? singingShift(notes) : 0;
      const placed = notes.map((note) => ({
        at: round(note.at),
        pitch: shift === 0 ? note.pitch : moveOctaves(note.pitch, shift),
        len: round(note.len),
        ...(note.lyric === undefined ? {} : { lyric: note.lyric }),
        ...(note.lineEnd === true ? { lineEnd: true } : {}),
      }));
      const sing = sung ? { sing: { engine: "neutrino", ...options.sing } } : {};
      return { instrument, name: name.toLowerCase(), gain: name === "Vocal" ? 0 : -3, ...sing, notes: fitRange(placed, instrument) };
    });
}

function harmonyTracks(spans: ChordSpan[], options: AbcToScoreOptions): unknown[] {
  if (spans.length === 0) return [];
  const tracks: unknown[] = [];
  const chordInstrument = options.chords ?? "grandpiano";
  if (chordInstrument !== false) {
    const notes = spans.map((span) => ({
      at: round(span.at),
      ...(span.voicing.chord === undefined ? { pitch: span.voicing.pitches } : { chord: span.voicing.chord }),
      len: round(span.len),
      vel: 0.55,
    }));
    tracks.push({ instrument: chordInstrument, name: "chords", gain: -8, notes });
  }
  const bassInstrument = options.bass ?? "grandpiano";
  if (bassInstrument !== false) {
    const notes = spans.map((span) => ({ at: round(span.at), pitch: span.voicing.bass, len: round(span.len), vel: 0.7 }));
    tracks.push({ instrument: bassInstrument, name: "bass", gain: -4, clef: "bass", notes: fitRange(notes, bassInstrument) });
  }
  return tracks;
}

/** The section asked for, with a bar before it when a sung line would start too soon. */
function arrange(whole: ParsedAbc, options: AbcToScoreOptions): ParsedAbc {
  const sliced = options.section === undefined ? whole : sliceSection(whole, options.section);
  // NEUTRINO sings a consonant before its note: a sung line needs a beat or more before it.
  const firstSung = sliced.voices.Vocal?.[0]?.at ?? Infinity;
  if (options.sing === undefined || firstSung >= 1) return sliced;
  return delay(sliced, barQuarters(parseMeter(sliced.meter) ?? { beats: 4, beatType: 4 }));
}

/** A JingleScript score playing YuE2's ABC: Vocal and Ins as melody tracks, chords and a bass line. */
export function abcToScore(abc: string | ParsedAbc, options: AbcToScoreOptions = {}): Score {
  const parsed = arrange(typeof abc === "string" ? parseAbc(abc) : abc, options);
  const flats = (parseKey(parsed.key)?.fifths ?? 0) < 0;
  const spans = parsed.chords.map((chord, index) => ({
    ...chord,
    len: (parsed.chords[index + 1]?.at ?? parsed.length) - chord.at,
    voicing: voiceChord(chord.symbol, flats),
  }));
  const tracks = [...melodyTracks(parsed, options), ...harmonyTracks(spans, options)];
  if (tracks.length === 0) throw new AbcError("the ABC has no notes and no chords");
  const cues: Record<string, { beats: number }> = {};
  const names = sectionNames(parsed);
  for (const [i, section] of parsed.sections.entries()) cues[names[i] ?? "section"] = { beats: round(section.at) };
  const title = options.title ?? parsed.title;
  return parseScore({
    format: FORMAT,
    ...(title === undefined ? {} : { title }),
    tempo: round(parsed.tempo),
    meter: parsed.meter,
    key: parsed.key,
    ...(parsed.pickup === undefined ? {} : { pickup: round(parsed.pickup) }),
    length: { beats: round(parsed.length + (options.tail ?? 2)) },
    seed: options.seed ?? 1,
    cues,
    tracks,
  });
}
