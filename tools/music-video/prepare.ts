// Score → the scene's data, using JingleScript's own resolver (no text matching):
//   node prepare.ts <score.json> <dataDir> [--cut <s>] [--instrument <name>]
// Writes <dataDir>/score.json (trimmed / re-instrumented, what gets rendered), timing.json
// (the timing map, audibleUntil = duration until the WAV is rendered) and notes.json.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseScore, expandScore, pitchToMidi, getInstrument, resolveAt, type NoteEvent } from "../../src/core.ts";
import { buildTiming } from "../../src/timing.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiToPitch = (m: number): string => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/** Fold one pitch name by octaves into [low, high] (MIDI). */
function fold(p: string, low: number, high: number): string {
  let m = pitchToMidi(p);
  if (m === undefined) return p;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return midiToPitch(m);
}

/** Play every track on `name`: drop pedals unless it has dampers, fold pitches (and chords) into range. */
export function swapInstrument(score: Json, name: string): void {
  const info = getInstrument(name);
  if (!info) throw new Error(`unknown instrument "${name}" (see: node src/cli.ts instruments)`);
  const range: [number, number] | null = info.range && [pitchToMidi(info.range.low) ?? 0, pitchToMidi(info.range.high) ?? 127];
  for (const t of score.tracks) {
    t.instrument = name;
    if (!info.damper) delete t.pedal;
    if (!range) continue;
    for (const n of t.notes ?? []) {
      if (typeof n.pitch === "string") n.pitch = fold(n.pitch, range[0], range[1]);
      else if (Array.isArray(n.pitch)) n.pitch = [...new Set(n.pitch.map((p: string) => fold(p, range[0], range[1])))];
    }
  }
}

/**
 * Cut to the first `cut` seconds with a fade-out. Placement (beats, cues, seconds, `end`, repeats)
 * is resolved by JingleScript itself; notes whose every onset is at or after cut − 0.5 s are dropped,
 * repeats are shortened, and pedals are clamped.
 */
export function trimScore(score: Json, cut: number, fade = 1.5): void {
  const limit = cut - 0.5;
  const ex = expandScore(parseScore(score));
  const kept = new Map<string, number>(); // "track|note" → repetitions before the limit
  for (const e of ex.events) {
    const k = `${e.track}|${e.note}`;
    kept.set(k, (kept.get(k) ?? 0) + (e.nominal < limit ? 1 : 0));
  }
  score.tracks.forEach((t: Json, ti: number) => {
    t.notes = (t.notes ?? []).filter((n: Json, ni: number) => {
      const c = kept.get(`${ti}|${ni}`) ?? 0;
      if (c > 0 && n.repeat) n.repeat = { every: n.repeat.every, count: c };
      return c > 0;
    });
    if (t.pedal)
      t.pedal = t.pedal.filter((p: Json) => {
        const at = resolveAt(p.at, ex.tempo, ex.cues);
        if (!at.ok || at.seconds >= limit) return false;
        const until = resolveAt(p.until, ex.tempo, ex.cues);
        if (until.ok && until.seconds > cut) p.until = { seconds: cut };
        return true;
      });
  });
  score.tracks = score.tracks.filter((t: Json) => t.notes.length > 0);
  for (const [name, seconds] of Object.entries(ex.cues)) if (seconds > cut && score.cues) delete score.cues[name];
  score.length = { seconds: cut + fade };
  score.master = { ...(score.master ?? {}), fadeOut: fade };
}

/** How long a note visibly sounds: its key release, a sustained hold, or a default for ringing notes. */
function visibleLength(e: NoteEvent): number {
  if (e.release !== undefined) return e.release - e.seconds;
  if (Number.isFinite(e.hold)) return e.hold;
  return 0.5;
}

/** One entry per sounding pitch (chords give several), sorted by time: what scenes animate. */
export function sceneNotes(events: NoteEvent[]): { t: number; m: number; pitch: string; vel: number; len: number; track: number }[] {
  return events
    .flatMap((e) =>
      e.pitches.flatMap((p, k) => {
        const m = pitchToMidi(p);
        if (m === undefined) return [];
        const off = e.strum?.offsets[k] ?? 0;
        return [{ t: Math.round((e.seconds + off) * 1000) / 1000, m, pitch: p, vel: e.vel, len: Math.max(0.05, visibleLength(e) - off), track: e.track }];
      }),
    )
    .sort((a, b) => a.t - b.t || a.m - b.m);
}

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { cut: { type: "string" }, instrument: { type: "string" } } });
const [input, dir] = positionals;
if (!input || !dir) {
  console.error("usage: node prepare.ts <score.json> <dataDir> [--cut <s>] [--instrument <name>]");
  process.exit(1);
}
const score: Json = JSON.parse(fs.readFileSync(input, "utf8"));
if (o.instrument) swapInstrument(score, o.instrument);
if (o.cut) trimScore(score, Number(o.cut));
const expanded = expandScore(parseScore(score));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify(score, null, 1));
fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(buildTiming(expanded, expanded.duration)));
const notes = sceneNotes(expanded.events);
fs.writeFileSync(path.join(dir, "notes.json"), JSON.stringify({ notes }));
console.log(`prepared ${notes.length} notes (${expanded.events.length} events), ${expanded.duration.toFixed(1)} s`);
