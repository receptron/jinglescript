// A parsed score → concrete note events in seconds, plus the problems that only show up once the
// whole score is known (a cue that does not exist, a pitch out of range, a note after the end).
// Rendering and the timing map both read these events, so they cannot disagree.
import { buildInstruments, type InstrumentTable } from "./custom/instruments.ts";
import { INSTRUMENT_NAMES, removedInstrument, type InstrumentDescriptor } from "./instruments/index.ts";
import { voiceChord } from "./chords.ts";
import { buildLyrics, type LyricLine } from "./lyrics.ts";
import { moraPhonemes } from "./singer/kana.ts";
import { barQuarters, DEFAULT_METER, parseMeter } from "./meter.ts";
import { pitchToMidi } from "./pitch.ts";
import { streamRng } from "./rng.ts";
import type { Note, ScoreData } from "./score-schema.ts";
import { DEFAULT_SPREAD_MS, normalizeStrum, strumSlots, voiceStrum, type StrumDirection } from "./strum.ts";
import { resolveAt, secondsPerBeat, timeToSeconds, type At, type ResolvedAt } from "./time.ts";

export type IssuePath = (string | number)[];

export interface Issue {
  path: IssuePath;
  message: string;
  hint?: string;
}

export interface NoteEvent {
  track: number;
  note: number;
  /** 0 for the note itself, 1… for its repetitions. */
  repeat: number;
  /** A built-in's or the score's own instrument's name. */
  instrument: string;
  /** Onset in seconds, humanize and strum looseness applied. */
  seconds: number;
  /** Onset as written, before any looseness: what "is this meant to be on a cue?" is judged on. */
  nominal: number;
  /** The cue this event sits exactly on, if any. */
  cue: string | undefined;
  /** Pitch names (a chord already voiced); empty for unpitched sounds. */
  pitches: string[];
  /** The chord symbol, when the note was written as one. */
  chord: string | undefined;
  /** Per-pitch timing and velocity of a strummed stroke. */
  strum: { direction: StrumDirection; offsets: number[]; weights: number[] } | undefined;
  vel: number;
  pan: number;
  gainDb: number;
  /** Seconds a sustained sound is held, or an effect with a length lasts. */
  hold: number;
  /** When an effect with a length ends, seconds (undefined for everything else). */
  end: number | undefined;
  /**
   * When the key is released, seconds: onset plus a written `len` (undefined without one, and for
   * effects with a length). Only instruments with dampers act on it.
   */
  release: number | undefined;
  variant: string | undefined;
  detune: number;
  /** The note's syllable (on its first event only). */
  lyric: string | undefined;
  /** A line of lyrics ends after this syllable (first event only). */
  lineEnd: boolean;
}

/** The sustain pedal down from `down` until `up`, seconds. */
export interface PedalSpan {
  down: number;
  up: number;
}

export interface Expanded {
  tempo: number;
  duration: number;
  cues: Record<string, number>;
  /** Sorted by onset, then track, then note. */
  events: NoteEvent[];
  /** The instruments the score can play: built-ins and its own. */
  instruments: InstrumentTable;
  /** Lyric lines of every track, sorted by start; empty when the score has no lyrics. */
  lyrics: LyricLine[];
  /** Each track's sustain pedal, by track index: stretches in seconds, in time order. */
  pedals: PedalSpan[][];
  issues: Issue[];
}

/** Sustained notes without `len` hold until the track's next onset, minus a gap (as in the prototype). */
const HOLD_FRACTION = 0.92;
const LAST_HOLD_SECONDS = 1.6;
const MAX_REPEATS = 256;
/** Floating-point slack when comparing times. */
const EPSILON = 1e-9;

const quoteList = (items: readonly string[]): string => items.map((item) => JSON.stringify(item)).join(", ");

function pitchList(pitch: Note["pitch"]): string[] {
  if (pitch === undefined) return [];
  return Array.isArray(pitch) ? pitch : [pitch];
}

function unknownCueIssue(path: IssuePath, cue: string, cues: Record<string, number>): Issue {
  const defined = Object.keys(cues);
  return {
    path,
    message: `Unknown cue "${cue}".`,
    hint: defined.length > 0 ? `Defined cues: ${defined.join(", ")}.` : `Define it first under "cues", e.g. "cues": { "${cue}": { "seconds": 1.5 } }.`,
  };
}

/** An instrument as a note sees it: its name (for messages) and what it is. */
interface Voice {
  name: string;
  descriptor: InstrumentDescriptor;
}

/** The pitches a note plays: its `pitch`, or its `chord` voiced for the instrument. */
function notePitches(note: Note, voice: Voice): string[] {
  if (note.chord !== undefined) return voiceChord(note.chord, voice.descriptor.tuning) ?? [];
  return pitchList(note.pitch);
}

function pitchIssues(note: Note, voice: Voice, path: IssuePath): Issue[] {
  const descriptor = voice.descriptor;
  const given = note.chord === undefined ? "pitch" : "chord";
  if (note.pitch !== undefined && note.chord !== undefined) {
    return [{ path: [...path, "chord"], message: "Give `pitch` or `chord`, not both.", hint: "Use `chord` for a named chord, `pitch` for exact notes." }];
  }
  if (!descriptor.pitched && descriptor.pitchOptional && note.chord === undefined) return rangeIssues(note, voice, path);
  if (!descriptor.pitched) {
    return note.pitch === undefined && note.chord === undefined
      ? []
      : [{ path: [...path, given], message: `"${voice.name}" is unpitched and takes no ${given}.`, hint: `Remove \`${given}\`.` }];
  }
  if (note.pitch === undefined && note.chord === undefined) {
    return [
      { path, message: `"${voice.name}" is pitched: this note needs a pitch or a chord.`, hint: 'Add "pitch": "C5", a list for a chord, or "chord": "C".' },
    ];
  }
  return rangeIssues(note, voice, path);
}

function rangeIssues(note: Note, voice: Voice, path: IssuePath): Issue[] {
  const given = note.chord === undefined ? "pitch" : "chord";
  const range = voice.descriptor.range;
  if (range === null) return [];
  const low = pitchToMidi(range.low) ?? 0;
  const high = pitchToMidi(range.high) ?? 127;
  return notePitches(note, voice).flatMap((pitch, i): Issue[] => {
    const midi = pitchToMidi(pitch);
    if (midi === undefined || (midi >= low && midi <= high)) return [];
    const pitchPath = Array.isArray(note.pitch) ? [...path, "pitch", i] : [...path, "pitch"];
    const where = given === "chord" ? [...path, "chord"] : pitchPath;
    return [{ path: where, message: `${pitch} is outside ${voice.name}'s range.`, hint: `Use ${range.low}–${range.high}; move it by an octave.` }];
  });
}

function strumIssues(note: Note, voice: Voice, path: IssuePath): Issue[] {
  if (note.strum === undefined || notePitches(note, voice).length >= 2) return [];
  return [{ path: [...path, "strum"], message: "`strum` needs a chord.", hint: 'Give "chord": "C" or a list of pitches, in string order.' }];
}
function lyricIssues(note: Note, voice: Voice, path: IssuePath): Issue[] {
  if (note.lyric === undefined) {
    return note.lineEnd === undefined
      ? []
      : [
          {
            path: [...path, "lineEnd"],
            message: "`lineEnd` needs a `lyric` on the same note.",
            hint: "Put `lineEnd` on the note with the line's last syllable.",
          },
        ];
  }
  if (!voice.descriptor.pitched) {
    return [
      { path: [...path, "lyric"], message: `"${voice.name}" plays no melody, so it cannot carry lyrics.`, hint: "Put the lyrics on the melody's notes." },
    ];
  }
  if (note.repeat !== undefined) {
    return [
      {
        path: [...path, "lyric"],
        message: "A note with `repeat` cannot carry a lyric.",
        hint: 'Write the repeated notes out, one syllable each, or use "_" to hold a syllable.',
      },
    ];
  }
  return [];
}

function variantIssues(note: Note, voice: Voice, path: IssuePath): Issue[] {
  if (note.variant === undefined) return [];
  const allowed = voice.descriptor.variants;
  const given = Array.isArray(note.variant) ? note.variant : [note.variant];
  const bad = given.filter((v) => !allowed.includes(v));
  if (bad.length === 0) return [];
  return [
    {
      path: [...path, "variant"],
      message: `"${voice.name}" has no variant ${quoteList(bad)}.`,
      hint: allowed.length > 0 ? `Variants: ${allowed.join(", ")}.` : `"${voice.name}" has no variants; remove \`variant\`.`,
    },
  ];
}

/** Onsets of a note and its repetitions, before humanize. */
function repeatTimes(note: Note, start: number, tempo: number, resolve: (at: At) => ResolvedAt): { times: number[]; until: ResolvedAt | undefined } {
  if (note.repeat === undefined) return { times: [start], until: undefined };
  const step = note.repeat.every * secondsPerBeat(tempo);
  if (note.repeat.count !== undefined) return { times: Array.from({ length: note.repeat.count }, (_, k) => start + k * step), until: undefined };
  const until = note.repeat.until === undefined ? undefined : resolve(note.repeat.until);
  if (until === undefined || !until.ok) return { times: [start], until };
  const times: number[] = [];
  for (let k = 0; k < MAX_REPEATS && start + k * step <= until.seconds + EPSILON; k++) times.push(start + k * step);
  return { times: times.length > 0 ? times : [start], until };
}

function variantAt(note: Note, repeat: number): string | undefined {
  if (note.variant === undefined || typeof note.variant === "string") return note.variant;
  return note.variant[repeat % note.variant.length];
}

interface NoteContext {
  score: ScoreData;
  /** The track's instrument. */
  descriptor: InstrumentDescriptor;
  cues: Record<string, number>;
  duration: number;
  trackIndex: number;
  noteIndex: number;
}

interface Stroke {
  /** Seconds after the repetition's start. */
  offset: number;
  direction: StrumDirection | undefined;
  weight: number;
}

/** The strokes one repetition of a note plays: itself, or each stroke of its strum pattern. */
function strokesOf(note: Note, tempo: number): Stroke[] {
  if (note.strum === undefined) return [{ offset: 0, direction: undefined, weight: 1 }];
  return strumSlots(normalizeStrum(note.strum)).slots.map((slot) => ({
    offset: slot.offset * secondsPerBeat(tempo),
    direction: slot.direction,
    weight: slot.weight,
  }));
}

function lenSeconds(len: number | { seconds: number }, tempo: number): number {
  return typeof len === "number" ? len * secondsPerBeat(tempo) : len.seconds;
}

/** How long an effect with a length lasts (its `len`, or its default); undefined for other sounds. */
function soundLength(note: Note, voice: Voice, tempo: number): number | undefined {
  const duration = voice.descriptor.duration;
  if (duration === undefined) return undefined;
  return note.len === undefined ? duration.defaultSeconds : lenSeconds(note.len, tempo);
}

/** Where a note starts: its `at`, or its `end` minus its length. Only a start exactly on a cue counts as on it. */
function startOf(note: Note, length: number, resolve: (at: At) => ResolvedAt): ResolvedAt {
  if (note.end === undefined) return resolve(note.at ?? 0);
  const end = resolve(note.end);
  return end.ok ? { ok: true, seconds: end.seconds - length, cue: undefined } : end;
}

function strumSpread(note: Note): number {
  return typeof note.strum === "object" ? (note.strum.spread ?? DEFAULT_SPREAD_MS) : DEFAULT_SPREAD_MS;
}

interface Placed {
  index: number;
  /** Seconds an effect with a length lasts; undefined for other sounds. */
  length: number | undefined;
  seconds: number;
  onCue: string | undefined;
  stroke: Stroke;
}

/** When a note's key is released: onset plus its written `len` (none for effects with a length). */
function releaseOf(note: Note, placed: Placed, seconds: number, tempo: number): number | undefined {
  return placed.length === undefined && note.len !== undefined ? seconds + lenSeconds(note.len, tempo) : undefined;
}

function noteEvent(note: Note, ctx: NoteContext, pitches: string[], placed: Placed): NoteEvent {
  const { score, trackIndex, noteIndex } = ctx;
  const track = score.tracks[trackIndex];
  const pinned = placed.onCue !== undefined;
  const humanize =
    note.humanize !== undefined && !pinned ? (streamRng(score.seed, "humanize", trackIndex, noteIndex, placed.index).next() * 2 - 1) * note.humanize : 0;
  const strum =
    placed.stroke.direction === undefined
      ? undefined
      : voiceStrum(pitches.length, placed.stroke.direction, strumSpread(note), pinned, streamRng(score.seed, "strum", trackIndex, noteIndex, placed.index));
  // Looseness never moves a note before the start.
  const seconds = Math.max(0, placed.seconds + humanize / 1000 + (strum?.shift ?? 0));
  return {
    track: trackIndex,
    note: noteIndex,
    repeat: placed.index,
    instrument: track?.instrument ?? "marimba",
    nominal: placed.seconds,
    seconds,
    cue: placed.onCue,
    pitches,
    chord: note.chord,
    strum:
      strum === undefined || placed.stroke.direction === undefined
        ? undefined
        : { direction: placed.stroke.direction, offsets: strum.offsets, weights: strum.weights },
    vel: note.vel * placed.stroke.weight,
    pan: note.pan ?? track?.pan ?? 0.5,
    gainDb: track?.gain ?? 0,
    hold: placed.length ?? (note.len === undefined ? Number.NaN : lenSeconds(note.len, score.tempo)),
    end: placed.length === undefined ? undefined : Math.max(0, placed.seconds) + placed.length,
    release: releaseOf(note, placed, seconds, score.tempo),
    variant: variantAt(note, placed.index),
    detune: note.detune ?? 0,
    ...lyricOf(note, placed.index),
  };
}

/** A note's lyric belongs to its first event only. */
function lyricOf(note: Note, index: number): Pick<NoteEvent, "lyric" | "lineEnd"> {
  return index === 0 ? { lyric: note.lyric, lineEnd: note.lineEnd === true } : { lyric: undefined, lineEnd: false };
}

function expandNote(note: Note, ctx: NoteContext): { events: NoteEvent[]; issues: Issue[] } {
  const { score, cues, trackIndex, noteIndex } = ctx;
  const track = score.tracks[trackIndex];
  if (track === undefined) return { events: [], issues: [] };
  const path: IssuePath = ["tracks", trackIndex, "notes", noteIndex];
  const voice: Voice = { name: track.instrument, descriptor: ctx.descriptor };
  const issues = [...pitchIssues(note, voice, path), ...variantIssues(note, voice, path), ...strumIssues(note, voice, path), ...lyricIssues(note, voice, path)];
  const resolve = (at: At): ResolvedAt => resolveAt(at, score.tempo, cues);
  const length = soundLength(note, voice, score.tempo);
  const longest = voice.descriptor.duration?.maxSeconds;
  if (length !== undefined && longest !== undefined && length > longest + EPSILON) {
    issues.push({
      path: [...path, note.len === undefined ? "end" : "len"],
      message: `"${voice.name}" lasts at most ${longest} s; this note asks for ${length.toFixed(3)} s.`,
      hint: "Make `len` shorter, or play several notes.",
    });
  }
  if (note.end !== undefined && length === undefined) {
    return {
      events: [],
      issues: [...issues, { path: [...path, "end"], message: `"${track.instrument}" has no length, so it cannot be placed by \`end\`.`, hint: "Use `at`." }],
    };
  }
  const start = startOf(note, length ?? 0, resolve);
  if (!start.ok) return { events: [], issues: [...issues, unknownCueIssue([...path, note.end === undefined ? "at" : "end"], start.unknownCue, cues)] };
  const { times, until } = repeatTimes(note, start.seconds, score.tempo, resolve);
  if (until !== undefined && !until.ok) issues.push(unknownCueIssue([...path, "repeat", "until"], until.unknownCue, cues));

  const pitches = notePitches(note, voice);
  const strokes = strokesOf(note, score.tempo);
  const events = times.flatMap((t, repeat) =>
    strokes.map((stroke, k) => {
      const index = repeat * strokes.length + k;
      const onCue = index === 0 ? start.cue : undefined;
      return noteEvent(note, ctx, pitches, { index, seconds: t + stroke.offset, onCue, stroke, length });
    }),
  );
  // One issue per note: the first sound that falls outside the jingle (a strum or a repeat that
  // overruns the end would otherwise list every stroke after it).
  for (const event of events) {
    const found = timeIssues(event, ctx.duration, path, soundOf(note, event.repeat, strokes.length));
    if (found.length > 0) {
      issues.push(...found);
      break;
    }
  }
  return { events, issues };
}

/** Which sound of a note an issue is about (the note, one of its repeats, a stroke of its strum), and what to do when it falls after the end. */
interface Sound {
  where: string;
  pastEndHint: string;
}

function soundOf(note: Note, index: number, strokesPerRepeat: number): Sound {
  const repeat = Math.floor(index / strokesPerRepeat);
  if (note.strum === undefined || strokesPerRepeat < 2) {
    return { where: repeat === 0 ? "This note" : `Repetition ${repeat + 1} of this note`, pastEndHint: "Make `length` longer or move the note earlier." };
  }
  const spec = normalizeStrum(note.strum);
  const inRepeat = repeat === 0 ? "" : ` in repetition ${repeat + 1}`;
  return {
    where: `Stroke ${(index % strokesPerRepeat) + 1} of this note's strum pattern "${spec.pattern}"${inRepeat}`,
    pastEndHint: `A strum pattern plays one stroke per character whatever the note's \`len\`: "${spec.pattern}" lasts ${strumSlots(spec).beats} beats from the note's \`at\`. Make \`length\` longer, move the note earlier, or end on a shorter pattern ("down" is one stroke).`,
  };
}

function timeIssues(event: NoteEvent, duration: number, path: IssuePath, { where, pastEndHint }: Sound): Issue[] {
  if (event.seconds < -EPSILON) {
    return [
      { path: [...path, "at"], message: `${where} starts before 0 s (${event.seconds.toFixed(3)} s).`, hint: "Move it later or reduce the negative offset." },
    ];
  }
  if (event.seconds >= duration - EPSILON) {
    return [
      {
        path: [...path, "at"],
        message: `${where} starts at ${event.seconds.toFixed(3)} s, at or after the end (length ${duration.toFixed(3)} s).`,
        hint: pastEndHint,
      },
    ];
  }
  return [];
}

/** Fill in hold lengths for notes without `len`: until the track's next onset, the last one ~1.6 s. */
function assignHolds(events: NoteEvent[]): void {
  const byTrack = new Map<number, NoteEvent[]>();
  for (const event of events) byTrack.set(event.track, [...(byTrack.get(event.track) ?? []), event]);
  for (const trackEvents of byTrack.values()) {
    const onsets = [...new Set(trackEvents.map((e) => e.seconds))].sort((a, b) => a - b);
    for (const event of trackEvents) {
      if (!Number.isNaN(event.hold)) continue;
      const next = onsets.find((t) => t > event.seconds + EPSILON);
      event.hold = next === undefined ? LAST_HOLD_SECONDS : (next - event.seconds) * HOLD_FRACTION;
    }
  }
}

function unknownInstrumentIssue(name: string, trackIndex: number, definitions: ScoreData["instruments"]): Issue {
  const custom = Object.keys(definitions ?? {});
  const removed = removedInstrument(name);
  if (removed !== undefined)
    return { path: ["tracks", trackIndex, "instrument"], message: removed, hint: "Write the instrument's new name; the notes stay as they are." };
  return {
    path: ["tracks", trackIndex, "instrument"],
    message: `Unknown instrument "${name}".`,
    hint: [
      `Built-in: ${INSTRUMENT_NAMES.join(", ")}.`,
      custom.length > 0 ? `Defined in this score: ${custom.join(", ")}.` : 'Or define it under "instruments".',
    ].join(" "),
  };
}

/** A track's pedal in seconds, and what keeps it from making sense. */
function expandPedal(
  track: ScoreData["tracks"][number],
  trackIndex: number,
  descriptor: InstrumentDescriptor,
  ctx: { tempo: number; cues: Record<string, number>; duration: number },
): { spans: PedalSpan[]; issues: Issue[] } {
  const marks = track.pedal ?? [];
  if (marks.length === 0) return { spans: [], issues: [] };
  if (descriptor.damper === undefined) {
    return {
      spans: [],
      issues: [
        {
          path: ["tracks", trackIndex, "pedal"],
          message: `"${track.instrument}" has no dampers, so a pedal does nothing: its notes ring out anyway.`,
          hint: 'Remove "pedal", or play the track on grandpiano.',
        },
      ],
    };
  }
  const spans: PedalSpan[] = [];
  const issues: Issue[] = [];
  marks.forEach((mark, k) => {
    const path: IssuePath = ["tracks", trackIndex, "pedal", k];
    const down = resolveAt(mark.at, ctx.tempo, ctx.cues);
    const up = resolveAt(mark.until, ctx.tempo, ctx.cues);
    if (!down.ok) issues.push(unknownCueIssue([...path, "at"], down.unknownCue, ctx.cues));
    if (!up.ok) issues.push(unknownCueIssue([...path, "until"], up.unknownCue, ctx.cues));
    if (!down.ok || !up.ok) return;
    const previous = spans.at(-1);
    if (down.seconds < -EPSILON) {
      issues.push({
        path: [...path, "at"],
        message: `The pedal goes down before 0 s (${down.seconds.toFixed(3)} s).`,
        hint: "Move it later or reduce the negative offset.",
      });
    } else if (up.seconds <= down.seconds + EPSILON) {
      issues.push({
        path: [...path, "until"],
        message: `The pedal lifts at ${up.seconds.toFixed(3)} s, not after it goes down (${down.seconds.toFixed(3)} s).`,
        hint: "`until` is when the pedal lifts; make it later than `at`.",
      });
    } else if (previous !== undefined && down.seconds < previous.up - EPSILON) {
      issues.push({
        path: [...path, "at"],
        message: `This pedal goes down at ${down.seconds.toFixed(3)} s, before the previous one lifts (${previous.up.toFixed(3)} s).`,
        hint: "List the stretches in time order without overlap; to change pedal, start the next where the last ends.",
      });
    } else if (up.seconds > ctx.duration + EPSILON) {
      issues.push({
        path: [...path, "until"],
        message: `The pedal lifts at ${up.seconds.toFixed(3)} s, after the end (${ctx.duration.toFixed(3)} s).`,
        hint: "Lift it by the end, or make `length` longer.",
      });
    } else {
      spans.push({ down: down.seconds, up: up.seconds });
    }
  });
  return { spans, issues };
}

/** A pickup is part of a bar: shorter than a whole one. */
function pickupIssues(score: ScoreData): Issue[] {
  const meter = parseMeter(score.meter ?? DEFAULT_METER);
  if (score.pickup === undefined || meter === undefined || score.pickup < barQuarters(meter)) return [];
  return [
    {
      path: ["pickup"],
      message: `pickup is ${score.pickup} beats, but a bar of ${score.meter ?? DEFAULT_METER} is ${barQuarters(meter)}.`,
      hint: "A pickup is the beats before the first full bar: less than one bar. Leave it out when the music starts on the bar.",
    },
  ];
}

/** A sung lyric NEUTRINO can take: one mora of kana, or "_"/"ー" to hold the previous vowel. */
export function isSingableLyric(lyric: string): boolean {
  const text = lyric.trim();
  return text === "_" || text === "ー" || moraPhonemes(text) !== undefined;
}

/** What NEUTRINO cannot sing, caught before it runs: more than one sung track, and lyrics that are not one kana mora. */
function singIssues(score: ScoreData): Issue[] {
  const sung = score.tracks.flatMap((track, index) => (track.sing ? [index] : []));
  const issues: Issue[] = sung.slice(1).map((index) => ({
    path: ["tracks", index, "sing"],
    message: `Only one track can be sung; tracks ${sung.join(", ")} all have "sing".`,
    hint: 'Keep "sing" on the melody track only; the other tracks play their instruments.',
  }));
  for (const index of sung) {
    score.tracks[index]?.notes.forEach((note, noteIndex) => {
      if (note.lyric === undefined || isSingableLyric(note.lyric)) return;
      issues.push({
        path: ["tracks", index, "notes", noteIndex, "lyric"],
        message: `NEUTRINO cannot sing "${note.lyric}": a sung track's lyric is one kana mora per note (e.g. "か", "きゃ", "ん"), or "_"/"ー" to hold the previous vowel.`,
        hint:
          [...note.lyric.trim()].length > 2
            ? 'Split the word into one note per mora, e.g. "かえる" → "か", "え", "る".'
            : "Write the words in hiragana or katakana (no romaji or English), one mora per note.",
      });
    });
  }
  return issues;
}

export function expandScore(score: ScoreData): Expanded {
  const cues: Record<string, number> = {};
  for (const [name, time] of Object.entries(score.cues)) cues[name] = timeToSeconds(time, score.tempo);
  const duration = timeToSeconds(score.length, score.tempo);
  const { table: instruments, issues } = buildInstruments(score.instruments);
  if (duration <= 0) issues.push({ path: ["length"], message: "length must be more than 0.", hint: 'e.g. "length": { "seconds": 4 }.' });
  issues.push(...pickupIssues(score));
  for (const [name, seconds] of Object.entries(cues)) {
    if (seconds > duration + EPSILON) {
      issues.push({
        path: ["cues", name],
        message: `Cue "${name}" is at ${seconds.toFixed(3)} s, after the end (${duration.toFixed(3)} s).`,
        hint: "Make `length` longer.",
      });
    }
  }
  const events: NoteEvent[] = [];
  const pedals: PedalSpan[][] = score.tracks.map(() => []);
  score.tracks.forEach((track, trackIndex) => {
    const instrument = instruments.get(track.instrument);
    if (instrument === undefined) {
      issues.push(unknownInstrumentIssue(track.instrument, trackIndex, score.instruments));
      return;
    }
    const pedal = expandPedal(track, trackIndex, instrument.descriptor, { tempo: score.tempo, cues, duration });
    pedals[trackIndex] = pedal.spans;
    issues.push(...pedal.issues);
    track.notes.forEach((note, noteIndex) => {
      const expanded = expandNote(note, { score, descriptor: instrument.descriptor, cues, duration, trackIndex, noteIndex });
      events.push(...expanded.events);
      issues.push(...expanded.issues);
    });
  });
  issues.push(...singIssues(score));
  assignHolds(events);
  events.sort((a, b) => a.seconds - b.seconds || a.track - b.track || a.note - b.note || a.repeat - b.repeat);
  const lyrics = buildLyrics(events, duration);
  issues.push(...lyrics.issues);
  return { tempo: score.tempo, duration, cues, events, instruments, lyrics: lyrics.lines, pedals, issues };
}
