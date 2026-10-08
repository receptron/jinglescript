// Lyrics: the syllables written on a track's notes, gathered into display lines with times. Nothing
// is sung — the words are text for a karaoke-style view. Each syllable's time is its note's onset,
// so it comes from the same events the audio and the timing map do. Joining syllables into words
// happens only here, so every view shows the same text.
import type { Issue, NoteEvent } from "./events.ts";

/** Holds the previous syllable over another note (melisma). */
export const HOLD_SYLLABLE = "_";

export interface LyricSyllable {
  /** As displayed: without a joining hyphen, with a trailing space when a new word follows. */
  text: string;
  seconds: number;
  end: number;
}

export interface LyricLine {
  track: number;
  /** Index of the line within its track. */
  line: number;
  /** The line as displayed: its syllables' text joined. */
  text: string;
  seconds: number;
  end: number;
  syllables: LyricSyllable[];
}

interface Syllable {
  raw: string;
  seconds: number;
  end: number;
}

/** Code point ranges of scripts written without spaces between words (Japanese, Chinese), with
 * their punctuation and full-width forms. */
const NO_SPACE_RANGES: readonly [number, number][] = [
  [0x3000, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function noSpaceScript(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && NO_SPACE_RANGES.some(([low, high]) => code >= low && code <= high);
}

const joinsNext = (raw: string): boolean => raw.length > 1 && raw.endsWith("-");
const shown = (raw: string): string => (joinsNext(raw) ? raw.slice(0, -1) : raw);

function joiner(raw: string, next: string | undefined): string {
  if (next === undefined || joinsNext(raw)) return "";
  const last = shown(raw).slice(-1);
  const first = shown(next).slice(0, 1);
  return noSpaceScript(last) && noSpaceScript(first) ? "" : " ";
}

function lineOf(track: number, line: number, syllables: readonly Syllable[]): LyricLine {
  const shownSyllables = syllables.map((s, i): LyricSyllable => ({
    text: shown(s.raw) + joiner(s.raw, syllables[i + 1]?.raw),
    seconds: s.seconds,
    end: s.end,
  }));
  return {
    track,
    line,
    text: shownSyllables.map((s) => s.text).join(""),
    seconds: syllables[0]?.seconds ?? 0,
    end: syllables.at(-1)?.end ?? 0,
    syllables: shownSyllables,
  };
}

const lyricPath = (event: NoteEvent, field: "lyric" | "lineEnd"): (string | number)[] => ["tracks", event.track, "notes", event.note, field];

interface Gathering {
  lines: Syllable[][];
  current: Syllable[];
  previous: (Syllable & { note: number }) | undefined;
  issues: Issue[];
}

/** `_`: the previous syllable lasts over this note too. */
function hold(state: Gathering, event: NoteEvent): void {
  if (state.previous === undefined) {
    state.issues.push({
      path: lyricPath(event, "lyric"),
      message: `"${HOLD_SYLLABLE}" holds the previous syllable, but no syllable comes before it on this track.`,
      hint: "Give this note a syllable of its own.",
    });
    return;
  }
  state.previous.end = Math.max(state.previous.end, event.seconds + event.hold);
}

function addSyllable(state: Gathering, event: NoteEvent, raw: string): void {
  const previous = state.previous;
  if (previous !== undefined && Math.abs(previous.seconds - event.seconds) < 1e-9) {
    state.issues.push({
      path: lyricPath(event, "lyric"),
      message: `Two syllables start at the same time on this track (this one and notes[${previous.note}]).`,
      hint: "One syllable per onset: a chord carries one lyric. Put a second singer's words on a track of its own.",
    });
    return;
  }
  if (previous !== undefined) previous.end = Math.min(previous.end, event.seconds);
  state.previous = { raw, seconds: event.seconds, end: event.seconds + event.hold, note: event.note };
  state.current.push(state.previous);
}

/** One track's lines. Events are in onset order; only a note's first event carries its lyric. */
function trackLines(track: number, events: readonly NoteEvent[], duration: number, issues: Issue[]): LyricLine[] {
  const state: Gathering = { lines: [], current: [], previous: undefined, issues };
  for (const event of events) {
    if (event.lyric === undefined) continue;
    if (event.lyric === HOLD_SYLLABLE) hold(state, event);
    else addSyllable(state, event, event.lyric);
    if (event.lineEnd && state.current.length > 0) {
      state.lines.push(state.current);
      state.current = [];
    }
  }
  if (state.current.length > 0) state.lines.push(state.current);
  if (state.previous !== undefined) state.previous.end = Math.min(state.previous.end, duration);
  return state.lines.map((syllables, line) => lineOf(track, line, syllables));
}

/** Every track's lyric lines, sorted by start, and the problems found while gathering them. */
export function buildLyrics(events: readonly NoteEvent[], duration: number): { lines: LyricLine[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const tracks = [...new Set(events.filter((e) => e.lyric !== undefined).map((e) => e.track))].sort((a, b) => a - b);
  const lines = tracks.flatMap((track) =>
    trackLines(
      track,
      events.filter((e) => e.track === track),
      duration,
      issues,
    ),
  );
  lines.sort((a, b) => a.seconds - b.seconds || a.track - b.track);
  return { lines, issues };
}
