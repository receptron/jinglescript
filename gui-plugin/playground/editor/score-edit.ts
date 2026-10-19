// The GUI's edits to a score, as pure functions from a score to the next one. A time is always
// rewritten in the form it was written in: beats stay beats, { "seconds" } stays seconds, and
// "hit+1" keeps its cue and changes its offset, so the JSON reads as if a person had edited it.
import { parseCueRef, pitchToMidi, resolveAt, ScoreBaseSchema, type InstrumentDescriptor, type NoteEvent, type ScoreInput } from "jinglescript/browser";

export type TrackInput = ScoreInput["tracks"][number];
export type NoteInput = TrackInput["notes"][number];
export type AtInput = NonNullable<NoteInput["at"]>;
export type CueInput = NonNullable<ScoreInput["cues"]>[string];
export type AtForm = "beats" | "seconds" | "cue";

export interface NoteRef {
  track: number;
  note: number;
}

export interface TimeContext {
  tempo: number;
  /** Cue times in seconds. */
  cues: Readonly<Record<string, number>>;
  /** Beats a time snaps to; undefined for no snapping. */
  gridBeats: number | undefined;
}

const PRECISION = 1e6;
/** Seconds written as { "seconds" } snap to this when the grid is on, and to a millisecond when it is off. */
const SECONDS_STEP = 0.01;
const FINE_SECONDS_STEP = 0.001;
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SEMITONES_PER_OCTAVE = 12;
const CHORD_ROOT = /^([A-G][#b]?)(.*)$/;

const round = (value: number): number => Math.round(value * PRECISION) / PRECISION;
const snap = (value: number, step: number | undefined): number => (step === undefined ? round(value) : round(Math.round(value / step) * step));

export function isScoreInput(value: unknown): value is ScoreInput {
  return ScoreBaseSchema.safeParse(value).success;
}

/** Why `value` is not a score the GUI can edit, or undefined when it is one. */
export function scoreProblem(value: unknown): string | undefined {
  const result = ScoreBaseSchema.safeParse(value);
  if (result.success) return undefined;
  const issue = result.error.issues[0];
  return issue === undefined ? "not a score" : `${issue.path.join(".") || "(score)"}: ${issue.message}`;
}

export function formOf(at: AtInput): AtForm {
  if (typeof at === "number") return "beats";
  return typeof at === "object" ? "seconds" : "cue";
}

/** A reference to `cue`, `offsetBeats` after it: "hit", "hit+1", "hit-0.5". */
export function formatCueRef(cue: string, offsetBeats: number): string {
  if (offsetBeats === 0) return cue;
  return `${cue}${offsetBeats > 0 ? "+" : "-"}${round(Math.abs(offsetBeats))}`;
}

function cueOffset(base: number, seconds: number, context: TimeContext): number {
  const secondsPerBeat = 60 / context.tempo;
  const offset = snap((seconds - base) / secondsPerBeat, context.gridBeats);
  if (base + offset * secondsPerBeat >= 0) return offset;
  // Before the start: the earliest offset on the grid that is not.
  const earliest = -base / secondsPerBeat;
  return context.gridBeats === undefined ? round(earliest) : round(Math.ceil(earliest / context.gridBeats) * context.gridBeats);
}

/** `at` rewritten, in its own form, to the time nearest `seconds` that the grid allows. */
export function atForSeconds(at: AtInput, seconds: number, context: TimeContext): AtInput {
  const target = Math.max(0, seconds);
  if (typeof at === "number") return Math.max(0, snap(target / (60 / context.tempo), context.gridBeats));
  if (typeof at === "object") return { seconds: snap(target, context.gridBeats === undefined ? FINE_SECONDS_STEP : SECONDS_STEP) };
  const ref = parseCueRef(at);
  const base = ref === undefined ? undefined : context.cues[ref.cue];
  if (ref === undefined || base === undefined) return at;
  return formatCueRef(ref.cue, cueOffset(base, target, context));
}

/** The time `seconds` written in `form` (for `cue`, relative to `cue`). */
export function atInForm(form: AtForm, seconds: number, context: TimeContext, cue?: string): AtInput {
  if (form === "cue" && cue !== undefined) return atForSeconds(cue, seconds, context);
  return atForSeconds(form === "seconds" ? { seconds: 0 } : 0, seconds, context);
}

/** A cue moved to `seconds`, in its own form. */
export function cueForSeconds(cue: CueInput, seconds: number, context: TimeContext): CueInput {
  const target = Math.max(0, seconds);
  if ("beats" in cue) return { beats: Math.max(0, snap(target / (60 / context.tempo), context.gridBeats)) };
  return { seconds: snap(target, context.gridBeats === undefined ? FINE_SECONDS_STEP : SECONDS_STEP) };
}

function mapTrack(score: ScoreInput, index: number, change: (track: TrackInput) => TrackInput): ScoreInput {
  return { ...score, tracks: score.tracks.map((track, i) => (i === index ? change(track) : track)) };
}

export function updateNote(score: ScoreInput, ref: NoteRef, change: (note: NoteInput) => NoteInput): ScoreInput {
  return mapTrack(score, ref.track, (track) => ({ ...track, notes: track.notes.map((note, i) => (i === ref.note ? change(note) : note)) }));
}

export function noteAt(score: ScoreInput, ref: NoteRef): NoteInput | undefined {
  return score.tracks[ref.track]?.notes[ref.note];
}

/**
 * The note moved so that the time it is anchored by (`end` for an effect placed by its end, `at`
 * otherwise) is `anchorSeconds`.
 */
export function moveNote(score: ScoreInput, ref: NoteRef, anchorSeconds: number, context: TimeContext): ScoreInput {
  return updateNote(score, ref, (note) => {
    if (note.end !== undefined) return { ...note, end: atForSeconds(note.end, anchorSeconds, context) };
    return { ...note, at: atForSeconds(note.at ?? 0, anchorSeconds, context) };
  });
}

/** Seconds a note is anchored at, from its first event: the end of an effect placed by `end`, else its onset. */
export function anchorSeconds(note: NoteInput, event: NoteEvent): number {
  return note.end !== undefined && event.end !== undefined ? event.end : event.nominal;
}

/** The note a new one on `track` copies: the latest one that starts by `seconds`, else the track's first. */
export function templateNote(score: ScoreInput, track: number, events: readonly NoteEvent[], seconds: number): NoteInput | undefined {
  const before = events.filter((e) => e.track === track && e.repeat === 0 && e.nominal <= seconds);
  const latest = before.reduce<NoteEvent | undefined>((best, e) => (best === undefined || e.nominal >= best.nominal ? e : best), undefined);
  return score.tracks[track]?.notes[latest?.note ?? 0];
}

/** A copy of `note` that is a fresh note: placed by `at` in beats, without repeats or lyrics. */
function freshCopy(note: NoteInput, at: AtInput): NoteInput {
  const { at: _at, end: _end, repeat: _repeat, lyric: _lyric, lineEnd: _lineEnd, ...sound } = note;
  return { at, ...sound };
}

/** A note added to `track` at `seconds`, sounding like `template`. */
export function addNote(score: ScoreInput, track: number, seconds: number, template: NoteInput, context: TimeContext): { score: ScoreInput; ref: NoteRef } {
  const notes = score.tracks[track]?.notes ?? [];
  const note = freshCopy(template, atForSeconds(0, seconds, context));
  return { score: mapTrack(score, track, (t) => ({ ...t, notes: [...t.notes, note] })), ref: { track, note: notes.length } };
}

/** A copy of the note (without its lyric) right after it in the list, anchored at `anchor` seconds. */
export function duplicateNote(score: ScoreInput, ref: NoteRef, anchor: number, context: TimeContext): { score: ScoreInput; ref: NoteRef } {
  const note = noteAt(score, ref);
  if (note === undefined) return { score, ref };
  const { lyric: _lyric, lineEnd: _lineEnd, ...copy } = note;
  const copyRef = { track: ref.track, note: ref.note + 1 };
  const next = mapTrack(score, ref.track, (t) => ({ ...t, notes: t.notes.toSpliced(copyRef.note, 0, copy) }));
  return { score: moveNote(next, copyRef, anchor, context), ref: copyRef };
}

/** Without the note; a track's last note takes the track with it, and the score's last note stays. */
export function removeNote(score: ScoreInput, ref: NoteRef): ScoreInput {
  const track = score.tracks[ref.track];
  if (track === undefined) return score;
  if (track.notes.length > 1) return mapTrack(score, ref.track, (t) => ({ ...t, notes: t.notes.filter((_, i) => i !== ref.note) }));
  return removeTrack(score, ref.track);
}

export function canRemoveNote(score: ScoreInput, ref: NoteRef): boolean {
  return score.tracks.length > 1 || (score.tracks[ref.track]?.notes.length ?? 0) > 1;
}

export function removeTrack(score: ScoreInput, index: number): ScoreInput {
  if (score.tracks.length <= 1) return score;
  return { ...score, tracks: score.tracks.filter((_, i) => i !== index) };
}

export function setTrack(score: ScoreInput, index: number, patch: Partial<TrackInput>): ScoreInput {
  return mapTrack(score, index, (track) => ({ ...track, ...patch }));
}

function midiToName(midi: number): string {
  return `${SHARP_NAMES[midi % SEMITONES_PER_OCTAVE] ?? "C"}${Math.floor(midi / SEMITONES_PER_OCTAVE) - 1}`;
}

/** The pitch in the middle of a range, to start a new track on. */
export function middlePitch(range: { low: string; high: string }): string | undefined {
  const low = pitchToMidi(range.low);
  const high = pitchToMidi(range.high);
  return low === undefined || high === undefined ? undefined : midiToName(Math.round((low + high) / 2));
}

/** A new track of `instrument` with one note at the start, its pitch in the middle of the range. */
export function addTrack(score: ScoreInput, instrument: string, descriptor: InstrumentDescriptor | undefined): ScoreInput {
  const pitch = descriptor?.pitched && descriptor.range ? middlePitch(descriptor.range) : undefined;
  const note: NoteInput = pitch === undefined ? { at: 0 } : { at: 0, pitch };
  return { ...score, tracks: [...score.tracks, { instrument, notes: [note] }] };
}

function transposePitch(pitch: string, semitones: number): string {
  const midi = pitchToMidi(pitch);
  return midi === undefined ? pitch : midiToName(midi + semitones);
}

function transposeChord(chord: string, semitones: number): string {
  const [, root = "", quality = ""] = CHORD_ROOT.exec(chord) ?? [];
  const midi = pitchToMidi(`${root}4`);
  if (midi === undefined) return chord;
  return `${SHARP_NAMES[(midi + semitones + SEMITONES_PER_OCTAVE * 10) % SEMITONES_PER_OCTAVE] ?? root}${quality}`;
}

/** The note `semitones` higher (lower when negative): its pitch, every pitch of a chord, or its chord's root. */
export function transpose(note: NoteInput, semitones: number): NoteInput {
  const pitch =
    note.pitch === undefined
      ? undefined
      : Array.isArray(note.pitch)
        ? note.pitch.map((p) => transposePitch(p, semitones))
        : transposePitch(note.pitch, semitones);
  const chord = note.chord === undefined ? undefined : transposeChord(note.chord, semitones);
  return { ...note, ...(pitch === undefined ? {} : { pitch }), ...(chord === undefined ? {} : { chord }) };
}

/** Every `at`, `end` and `until` in the score, with where it sits. */
function times(score: ScoreInput): AtInput[] {
  return score.tracks
    .flatMap((track) => [
      ...track.notes.flatMap((note) => [note.at, note.end, note.repeat?.until]),
      ...(track.pedal ?? []).flatMap((span) => [span.at, span.until]),
    ])
    .filter((at): at is AtInput => at !== undefined);
}

/** How many times the score refers to cue `name`. */
export function cueUses(score: ScoreInput, name: string): number {
  return times(score).filter((at) => typeof at === "string" && parseCueRef(at)?.cue === name).length;
}

export function setCue(score: ScoreInput, name: string, cue: CueInput): ScoreInput {
  return { ...score, cues: { ...score.cues, [name]: cue } };
}

/** Without cue `name`; a cue still in use stays (the notes on it would lose their time). */
export function removeCue(score: ScoreInput, name: string): ScoreInput {
  if (cueUses(score, name) > 0) return score;
  const cues = Object.fromEntries(Object.entries(score.cues ?? {}).filter(([key]) => key !== name));
  return { ...score, cues };
}

/** A cue name not yet used: `base`, else `base2`, `base3` … */
export function freshCueName(score: ScoreInput, base: string): string {
  const taken = new Set(Object.keys(score.cues ?? {}));
  if (!taken.has(base)) return base;
  const suffix = Array.from({ length: taken.size + 1 }, (_, i) => i + 2).find((n) => !taken.has(`${base}${n}`));
  return `${base}${suffix ?? taken.size + 2}`;
}

/**
 * Where `at` lands, in seconds, once moved toward `seconds` and snapped: what a drag shows. An effect
 * placed by its end cannot start before 0, so its end lands no earlier than its length (`floor`).
 */
export function snappedSeconds(at: AtInput, seconds: number, context: TimeContext, floor = 0): number {
  const resolved = resolveAt(atForSeconds(at, seconds, context), context.tempo, context.cues);
  return Math.max(floor, resolved.ok ? resolved.seconds : seconds);
}

/** A drag on the timeline: a note's anchor or a cue moved to `seconds`. */
export type TimelineMove = { kind: "note"; ref: NoteRef; seconds: number } | { kind: "cue"; name: string; seconds: number };

/** The score with `move` made: what a drag previews while it is held and writes when it is let go. */
export function applyMove(score: ScoreInput, move: TimelineMove, context: TimeContext): ScoreInput {
  if (move.kind === "note") return moveNote(score, move.ref, move.seconds, context);
  const cue = score.cues?.[move.name];
  return cue === undefined ? score : setCue(score, move.name, cueForSeconds(cue, move.seconds, context));
}
