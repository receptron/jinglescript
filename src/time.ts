// The one place beats, cues and seconds are converted. Scores speak beats (musical time) and
// seconds (the animation's time); audio and the timing map speak seconds. Everything that needs a
// time imports it from here.

export const CUE_NAME_PATTERN = /^[a-z]\w*$/;
/** A cue reference in `at`: a cue name, optionally with an offset in beats ("hit", "hit+1", "hit-0.25"). */
export const CUE_REF_PATTERN = /^([a-z]\w*)(?:([+-])(\d+(?:\.\d+)?))?$/;

export type Time = { seconds: number } | { beats: number };
export type At = number | { seconds: number } | string;

export function secondsPerBeat(tempo: number): number {
  return 60 / tempo;
}

export function beatsToSeconds(beats: number, tempo: number): number {
  return beats * secondsPerBeat(tempo);
}

export function secondsToBeats(seconds: number, tempo: number): number {
  return seconds / secondsPerBeat(tempo);
}

export function timeToSeconds(time: Time, tempo: number): number {
  return "seconds" in time ? time.seconds : beatsToSeconds(time.beats, tempo);
}

export interface CueRef {
  cue: string;
  offsetBeats: number;
}

export function parseCueRef(text: string): CueRef | undefined {
  const match = CUE_REF_PATTERN.exec(text);
  if (!match) return undefined;
  const [, cue = "", sign, amount] = match;
  const offset = amount === undefined ? 0 : Number(amount);
  return { cue, offsetBeats: sign === "-" ? -offset : offset };
}

export type ResolvedAt = { ok: true; seconds: number; cue: string | undefined } | { ok: false; unknownCue: string };

/**
 * Seconds of an `at`. `cue` is set only when the note sits exactly on a cue (no offset), which is
 * what the timing map reports and what `humanize` must not move.
 */
export function resolveAt(at: At, tempo: number, cues: Readonly<Record<string, number>>): ResolvedAt {
  if (typeof at === "number") return { ok: true, seconds: beatsToSeconds(at, tempo), cue: undefined };
  if (typeof at === "object") return { ok: true, seconds: at.seconds, cue: undefined };
  const ref = parseCueRef(at);
  const base = ref === undefined ? undefined : cues[ref.cue];
  if (ref === undefined || base === undefined) return { ok: false, unknownCue: ref?.cue ?? at };
  return { ok: true, seconds: base + beatsToSeconds(ref.offsetBeats, tempo), cue: ref.offsetBeats === 0 ? ref.cue : undefined };
}

/** The sample a time in seconds starts at. Rendering and the timing map both use this. */
export function secondsToSample(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

/** Seconds rounded to 1 ms, as the timing map reports them. */
export function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
