// Score → the scene's data, using JingleScript's own resolver (no text matching):
//   node prepare.ts <score.json> <dataDir> [--cut <s>] [--instrument <name>]
// Writes <dataDir>/score.json (trimmed / re-instrumented, what gets rendered), timing.json
// (the timing map, audibleUntil = duration until the WAV is rendered) and notes.json.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseScore, expandScore, pitchToMidi, getInstrument, resolveAt, type NoteEvent, type Score } from "../../src/core.ts";
import { midiToPitch } from "../../src/chords.ts";
import { normalizeStrum, strumSlots } from "../../src/strum.ts";
import { buildTiming } from "../../src/timing.ts";

/** Fold one pitch name by octaves into [low, high] (MIDI). */
function fold(p: string, low: number, high: number): string {
  let m = pitchToMidi(p);
  if (m === undefined) return p;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return midiToPitch(m, false);
}

/** Play every track on `name`: drop pedals unless it has dampers, fold pitches (and chords) into range. */
export function swapInstrument(score: Score, name: string): void {
  const info = getInstrument(name);
  if (!info) throw new Error(`unknown instrument "${name}" (see: node src/cli.ts instruments)`);
  const range: [number, number] | null = info.range && [pitchToMidi(info.range.low) ?? 0, pitchToMidi(info.range.high) ?? 127];
  for (const t of score.tracks) {
    t.instrument = name;
    if (!info.damper) delete t.pedal;
    if (!range) continue;
    for (const n of t.notes) {
      if (typeof n.pitch === "string") n.pitch = fold(n.pitch, range[0], range[1]);
      else if (Array.isArray(n.pitch)) n.pitch = [...new Set(n.pitch.map((p) => fold(p, range[0], range[1])))];
    }
  }
}

/** Every string anywhere in a value (to find which cues are still referred to). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/**
 * Cut to the first `cut` seconds with a fade-out. Placement (beats, cues, seconds, `end`, repeats)
 * is resolved by JingleScript itself; notes whose every onset is at or after cut − 0.5 s are dropped,
 * repeats are shortened, and pedals are clamped.
 */
export function trimScore(score: Score, cut: number, fade = 1.5): void {
  const limit = cut - 0.5;
  const ex = expandScore(score);
  // repetitions whose first stroke starts before the limit (a strum pattern gives several events per repetition)
  const kept = new Map<string, number>(); // "track|note" → repetitions kept
  const first = new Map<string, number>(); // "track|note" → nominal onset of the note itself
  for (const e of ex.events) {
    const n = score.tracks[e.track]?.notes[e.note];
    const strokes = n?.strum === undefined ? 1 : strumSlots(normalizeStrum(n.strum)).slots.length;
    const k = `${e.track}|${e.note}`;
    if (e.repeat === 0) first.set(k, e.nominal);
    if (e.repeat % strokes === 0 && e.nominal < limit) kept.set(k, (kept.get(k) ?? 0) + 1);
  }
  // cues after the cut go (a cue past the end is an error); placements that refer to one become seconds
  const dropped = Object.keys(score.cues ?? {}).filter((name) => (ex.cues[name] ?? 0) > cut);
  const refersToDropped = (v: unknown) => strings(v).some((x) => dropped.some((c) => x === c || x.startsWith(`${c}+`) || x.startsWith(`${c}-`)));
  score.tracks.forEach((t, ti) => {
    t.notes = t.notes.filter((n, ni) => {
      const c = kept.get(`${ti}|${ni}`) ?? 0;
      if (c > 0 && n.repeat) n.repeat = { every: n.repeat.every, count: c };
      if (c > 0 && refersToDropped([n.at, n.end])) {
        n.at = { seconds: first.get(`${ti}|${ni}`) ?? 0 };
        delete n.end;
      }
      return c > 0;
    });
    if (t.pedal)
      t.pedal = t.pedal.filter((p) => {
        const at = resolveAt(p.at, ex.tempo, ex.cues);
        if (!at.ok || at.seconds >= limit) return false;
        if (refersToDropped(p.at)) p.at = { seconds: at.seconds };
        const until = resolveAt(p.until, ex.tempo, ex.cues);
        if (until.ok && (until.seconds > cut || refersToDropped(p.until))) p.until = { seconds: Math.min(cut, until.seconds) };
        return true;
      });
  });
  score.tracks = score.tracks.filter((t) => t.notes.length > 0);
  if (score.cues) score.cues = Object.fromEntries(Object.entries(score.cues).filter(([name]) => !dropped.includes(name)));
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
const score = parseScore(JSON.parse(fs.readFileSync(input, "utf8"))); // validated (zod) on entry
if (o.instrument) swapInstrument(score, o.instrument);
if (o.cut) trimScore(score, Number(o.cut));
const expanded = expandScore(parseScore(score)); // re-validate after trimming / re-instrumenting
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify(score, null, 1));
fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(buildTiming(expanded, expanded.duration)));
const notes = sceneNotes(expanded.events);
fs.writeFileSync(path.join(dir, "notes.json"), JSON.stringify({ notes }));
console.log(`prepared ${notes.length} notes (${expanded.events.length} events), ${expanded.duration.toFixed(1)} s`);
