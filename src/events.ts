// A parsed score → concrete note events in seconds, plus the problems that only show up once the
// whole score is known (a cue that does not exist, a pitch out of range, a note after the end).
// Rendering and the timing map both read these events, so they cannot disagree.
import { descriptorOf, type InstrumentName } from "./instruments/index.ts";
import { pitchToMidi } from "./pitch.ts";
import { streamRng } from "./rng.ts";
import type { Note, ScoreData } from "./score-schema.ts";
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
  /** Pitch names; empty for unpitched sounds. */
  pitches: string[];
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

function pitchIssues(note: Note, instrument: InstrumentName, path: IssuePath): Issue[] {
  const descriptor = descriptorOf(instrument);
  if (!descriptor.pitched) {
    return note.pitch === undefined ? [] : [{ path: [...path, "pitch"], message: `"${instrument}" is unpitched and takes no pitch.`, hint: "Remove `pitch`." }];
  }
  if (note.pitch === undefined) {
    return [{ path, message: `"${instrument}" is pitched: this note needs a pitch.`, hint: 'Add "pitch": "C5" (or a list for a chord).' }];
  }
  const range = descriptor.range;
  if (range === null) return [];
  const low = pitchToMidi(range.low) ?? 0;
  const high = pitchToMidi(range.high) ?? 127;
  return pitchList(note.pitch).flatMap((pitch, i): Issue[] => {
    const midi = pitchToMidi(pitch);
    if (midi === undefined || (midi >= low && midi <= high)) return [];
    return [
      {
        path: Array.isArray(note.pitch) ? [...path, "pitch", i] : [...path, "pitch"],
        message: `${pitch} is outside ${instrument}'s range.`,
        hint: `Use ${range.low}–${range.high}; move it by an octave.`,
      },
    ];
  });
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

function expandNote(note: Note, ctx: NoteContext): { events: NoteEvent[]; issues: Issue[] } {
  const { score, cues, trackIndex, noteIndex } = ctx;
  const track = score.tracks[trackIndex];
  if (track === undefined) return { events: [], issues: [] };
  const path: IssuePath = ["tracks", trackIndex, "notes", noteIndex];
  const issues = [...pitchIssues(note, track.instrument, path), ...variantIssues(note, track.instrument, path)];
  const resolve = (at: At): ResolvedAt => resolveAt(at, score.tempo, cues);
  const start = resolve(note.at);
  if (!start.ok) return { events: [], issues: [...issues, unknownCueIssue([...path, "at"], start.unknownCue, cues)] };
  const { times, until } = repeatTimes(note, start.seconds, score.tempo, resolve);
  if (until !== undefined && !until.ok) issues.push(unknownCueIssue([...path, "repeat", "until"], until.unknownCue, cues));

  const pitches = pitchList(note.pitch);
  const events = times.map((t, repeat): NoteEvent => {
    const onCue = repeat === 0 ? start.cue : undefined;
    const jitter =
      note.humanize !== undefined && onCue === undefined
        ? (streamRng(score.seed, "humanize", trackIndex, noteIndex, repeat).next() * 2 - 1) * note.humanize
        : 0;
    return {
      track: trackIndex,
      note: noteIndex,
      repeat,
      instrument: track.instrument,
      seconds: t + jitter / 1000,
      cue: onCue,
      pitches,
      vel: note.vel,
      pan: note.pan ?? track.pan,
      gainDb: track.gain,
      hold: note.len === undefined ? Number.NaN : note.len * secondsPerBeat(score.tempo),
      variant: variantAt(note, repeat),
      detune: note.detune ?? 0,
    };
  });
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
