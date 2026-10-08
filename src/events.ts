// A parsed score → concrete note events in seconds, plus the problems that only show up once the
// whole score is known (a cue that does not exist, a pitch out of range, a note after the end).
// Rendering and the timing map both read these events, so they cannot disagree.
import { descriptorOf, type InstrumentName } from "./instruments/index.ts";
import { voiceChord } from "./chords.ts";
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
  instrument: InstrumentName;
  /** Onset in seconds, humanize applied. */
  seconds: number;
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
  /** Seconds a sustained sound is held. */
  hold: number;
  variant: string | undefined;
  detune: number;
}

export interface Expanded {
  tempo: number;
  duration: number;
  cues: Record<string, number>;
  /** Sorted by onset, then track, then note. */
  events: NoteEvent[];
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

/** The pitches a note plays: its `pitch`, or its `chord` voiced for the instrument. */
function notePitches(note: Note, instrument: InstrumentName): string[] {
  if (note.chord !== undefined) return voiceChord(note.chord, descriptorOf(instrument).tuning) ?? [];
  return pitchList(note.pitch);
}

function pitchIssues(note: Note, instrument: InstrumentName, path: IssuePath): Issue[] {
  const descriptor = descriptorOf(instrument);
  const given = note.chord === undefined ? "pitch" : "chord";
  if (note.pitch !== undefined && note.chord !== undefined) {
    return [{ path: [...path, "chord"], message: "Give `pitch` or `chord`, not both.", hint: "Use `chord` for a named chord, `pitch` for exact notes." }];
  }
  if (!descriptor.pitched) {
    return note.pitch === undefined && note.chord === undefined
      ? []
      : [{ path: [...path, given], message: `"${instrument}" is unpitched and takes no ${given}.`, hint: `Remove \`${given}\`.` }];
  }
  if (note.pitch === undefined && note.chord === undefined) {
    return [
      { path, message: `"${instrument}" is pitched: this note needs a pitch or a chord.`, hint: 'Add "pitch": "C5", a list for a chord, or "chord": "C".' },
    ];
  }
  const range = descriptor.range;
  if (range === null) return [];
  const low = pitchToMidi(range.low) ?? 0;
  const high = pitchToMidi(range.high) ?? 127;
  return notePitches(note, instrument).flatMap((pitch, i): Issue[] => {
    const midi = pitchToMidi(pitch);
    if (midi === undefined || (midi >= low && midi <= high)) return [];
    const pitchPath = Array.isArray(note.pitch) ? [...path, "pitch", i] : [...path, "pitch"];
    const where = given === "chord" ? [...path, "chord"] : pitchPath;
    return [{ path: where, message: `${pitch} is outside ${instrument}'s range.`, hint: `Use ${range.low}–${range.high}; move it by an octave.` }];
  });
}

function strumIssues(note: Note, instrument: InstrumentName, path: IssuePath): Issue[] {
  if (note.strum === undefined || notePitches(note, instrument).length >= 2) return [];
  return [{ path: [...path, "strum"], message: "`strum` needs a chord.", hint: 'Give "chord": "C" or a list of pitches, in string order.' }];
}
function variantIssues(note: Note, instrument: InstrumentName, path: IssuePath): Issue[] {
  if (note.variant === undefined) return [];
  const allowed = descriptorOf(instrument).variants;
  const given = Array.isArray(note.variant) ? note.variant : [note.variant];
  const bad = given.filter((v) => !allowed.includes(v));
  if (bad.length === 0) return [];
  return [
    {
      path: [...path, "variant"],
      message: `"${instrument}" has no variant ${quoteList(bad)}.`,
      hint: allowed.length > 0 ? `Variants: ${allowed.join(", ")}.` : `"${instrument}" has no variants; remove \`variant\`.`,
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

function strumSpread(note: Note): number {
  return typeof note.strum === "object" ? (note.strum.spread ?? DEFAULT_SPREAD_MS) : DEFAULT_SPREAD_MS;
}

interface Placed {
  index: number;
  seconds: number;
  onCue: string | undefined;
  stroke: Stroke;
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
  return {
    track: trackIndex,
    note: noteIndex,
    repeat: placed.index,
    instrument: track?.instrument ?? "marimba",
    // Looseness never moves a note before the start.
    seconds: Math.max(0, placed.seconds + humanize / 1000 + (strum?.shift ?? 0)),
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
    hold: note.len === undefined ? Number.NaN : note.len * secondsPerBeat(score.tempo),
    variant: variantAt(note, placed.index),
    detune: note.detune ?? 0,
  };
}

function expandNote(note: Note, ctx: NoteContext): { events: NoteEvent[]; issues: Issue[] } {
  const { score, cues, trackIndex, noteIndex } = ctx;
  const track = score.tracks[trackIndex];
  if (track === undefined) return { events: [], issues: [] };
  const path: IssuePath = ["tracks", trackIndex, "notes", noteIndex];
  const issues = [...pitchIssues(note, track.instrument, path), ...variantIssues(note, track.instrument, path), ...strumIssues(note, track.instrument, path)];
  const resolve = (at: At): ResolvedAt => resolveAt(at, score.tempo, cues);
  const start = resolve(note.at);
  if (!start.ok) return { events: [], issues: [...issues, unknownCueIssue([...path, "at"], start.unknownCue, cues)] };
  const { times, until } = repeatTimes(note, start.seconds, score.tempo, resolve);
  if (until !== undefined && !until.ok) issues.push(unknownCueIssue([...path, "repeat", "until"], until.unknownCue, cues));

  const pitches = notePitches(note, track.instrument);
  const strokes = strokesOf(note, score.tempo);
  const events = times.flatMap((t, repeat) =>
    strokes.map((stroke, k) => {
      const index = repeat * strokes.length + k;
      const onCue = index === 0 ? start.cue : undefined;
      return noteEvent(note, ctx, pitches, { index, seconds: t + stroke.offset, onCue, stroke });
    }),
  );
  for (const event of events) issues.push(...timeIssues(event, ctx.duration, path));
  return { events, issues };
}
function timeIssues(event: NoteEvent, duration: number, path: IssuePath): Issue[] {
  const where = event.repeat === 0 ? "This note" : `Repetition ${event.repeat + 1} of this note`;
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
        hint: "Make `length` longer or move the note earlier.",
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

export function expandScore(score: ScoreData): Expanded {
  const cues: Record<string, number> = {};
  for (const [name, time] of Object.entries(score.cues)) cues[name] = timeToSeconds(time, score.tempo);
  const duration = timeToSeconds(score.length, score.tempo);
  const issues: Issue[] = [];
  if (duration <= 0) issues.push({ path: ["length"], message: "length must be more than 0.", hint: 'e.g. "length": { "seconds": 4 }.' });
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
  score.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((note, noteIndex) => {
      const expanded = expandNote(note, { score, cues, duration, trackIndex, noteIndex });
      events.push(...expanded.events);
      issues.push(...expanded.issues);
    });
  });
  assignHolds(events);
  events.sort((a, b) => a.seconds - b.seconds || a.track - b.track || a.note - b.note || a.repeat - b.repeat);
  return { tempo: score.tempo, duration, cues, events, issues };
}
