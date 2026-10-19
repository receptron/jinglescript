// Where the timeline draws each sound: one block per event of the expanded score (a note and each of
// its repeats), placed at its onset as written, before humanize and strum looseness.
import { pitchToMidi, type Expanded, type NoteEvent } from "jinglescript/browser";

export interface Block {
  track: number;
  note: number;
  /** 0 for the note itself; its repeats follow it when it is dragged. */
  repeat: number;
  start: number;
  /** Seconds it holds or lasts; 0 for a sound that rings out on its own. */
  length: number;
  /** 0 at the top of the lane (the track's highest pitch) to 1 at the bottom; 0.5 when unpitched. */
  height: number;
  label: string;
}

const MIDDLE = 0.5;
/** Width of the column of track names and instruments left of the lanes. */
export const TRACK_HEADER_PX = 150;

function meanMidi(event: NoteEvent): number | undefined {
  const midis = event.pitches.map(pitchToMidi).filter((m): m is number => m !== undefined);
  return midis.length === 0 ? undefined : midis.reduce((sum, m) => sum + m, 0) / midis.length;
}

function label(event: NoteEvent): string {
  if (event.chord !== undefined) return event.chord;
  const [first, ...rest] = event.pitches;
  if (first !== undefined) return rest.length > 0 ? `${first}+${rest.length}` : first;
  return event.variant ?? "•";
}

/** Each track's lowest and highest mean pitch, in MIDI numbers. */
function pitchRanges(events: readonly NoteEvent[]): Map<number, { low: number; high: number }> {
  const ranges = new Map<number, { low: number; high: number }>();
  events.forEach((event) => {
    const midi = meanMidi(event);
    if (midi === undefined) return;
    const range = ranges.get(event.track);
    ranges.set(event.track, { low: Math.min(range?.low ?? midi, midi), high: Math.max(range?.high ?? midi, midi) });
  });
  return ranges;
}

export function timelineBlocks(expanded: Expanded): Block[] {
  const ranges = pitchRanges(expanded.events);
  return expanded.events.map((event) => {
    const midi = meanMidi(event);
    const range = ranges.get(event.track);
    const spread = range === undefined ? 0 : range.high - range.low;
    const height = midi === undefined || range === undefined || spread === 0 ? MIDDLE : (range.high - midi) / spread;
    const sustains = expanded.instruments.get(event.instrument)?.descriptor.sustained === true || event.end !== undefined;
    return { track: event.track, note: event.note, repeat: event.repeat, start: event.nominal, length: sustains ? event.hold : 0, height, label: label(event) };
  });
}

/** Beat lines up to `duration`, with every `beatsPerBar`-th one marked as a bar line. */
export function beatLines(tempo: number, duration: number, beatsPerBar = 4): { seconds: number; bar: boolean }[] {
  const secondsPerBeat = 60 / tempo;
  const count = Math.floor(duration / secondsPerBeat + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => ({ seconds: i * secondsPerBeat, bar: i % beatsPerBar === 0 }));
}
