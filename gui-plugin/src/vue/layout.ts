// Pure layout for the player: where things go on the waveform, in a 0–1000 wide coordinate space.
import type { PlayerData } from "jinglescript";

export const WIDTH = 1000;
/** Track colours; orange is kept for cues, so no track uses it. */
export const TRACK_COLORS = ["#4f7cff", "#19a979", "#c94fd6", "#2bb5c9", "#e2b33c", "#d64f6b", "#7a8a99", "#8a6cff"];

export const xOf = (seconds: number, duration: number): number => (duration > 0 ? (seconds / duration) * WIDTH : 0);

/** The waveform as one mirrored path around `mid`, `half` high. */
export function waveformPath(peaks: readonly number[], mid: number, half: number): string {
  if (peaks.length === 0) return "";
  const step = WIDTH / peaks.length;
  const top = peaks.map((p, i) => `${(i * step).toFixed(1)},${(mid - p * half).toFixed(1)}`);
  const bottom = peaks.map((p, i) => `${(i * step).toFixed(1)},${(mid + p * half).toFixed(1)}`).reverse();
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}

export function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

export interface Lane {
  name: string;
  color: string;
  /** `x2` is where an effect with a length ends (drawn as a bar). */
  notes: { x: number; x2: number | undefined; label: string; cue: string | undefined }[];
}

/** One lane per track with a dot per note (chords and strums are one dot). */
export function lanes(data: PlayerData): Lane[] {
  return data.tracks.map((name, track) => ({
    name,
    color: TRACK_COLORS[track % TRACK_COLORS.length] ?? "#888",
    notes: data.timing.notes
      .filter((n) => n.track === track)
      .map((n) => {
        const what = n.chord ?? (Array.isArray(n.pitch) ? n.pitch.join(" ") : n.pitch) ?? n.variant ?? n.instrument;
        const until = n.end === undefined ? "" : `–${n.end.toFixed(3)} s`;
        return {
          x: xOf(n.t, data.duration),
          x2: n.end === undefined ? undefined : xOf(n.end, data.duration),
          label: `${n.t.toFixed(3)}${until} s · ${n.instrument} · ${what}`,
          cue: n.cue,
        };
      }),
  }));
}

export interface KaraokeLine {
  key: string;
  /** `progress` 0–1: how much of the syllable has been sung (the wipe). */
  syllables: { text: string; progress: number }[];
}

const progressOf = (t: number, end: number, now: number): number => (end > t ? Math.min(1, Math.max(0, (now - t) / (end - t))) : now >= t ? 1 : 0);

/** The lyric lines to show at `now`: the line being sung (or the first, before it starts) and the next. */
export function karaoke(lyrics: PlayerData["timing"]["lyrics"], now: number): KaraokeLine[] {
  if (lyrics === undefined || lyrics.length === 0) return [];
  const started = lyrics.findLastIndex((line) => line.t <= now);
  const current = Math.max(0, started);
  return lyrics.slice(current, current + 2).map((line) => ({
    key: `${line.track}:${line.line}`,
    syllables: line.syllables.map((s) => ({ text: s.text, progress: progressOf(s.t, s.end, now) })),
  }));
}
