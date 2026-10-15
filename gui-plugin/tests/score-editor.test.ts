// The timeline's edits, checked against the library: every moved time is resolved by expandScore,
// the same code the renderer places sounds with.
import { readdirSync, readFileSync } from "node:fs";
import { AtSchema, checkScore, expandScore, parseCueRef, ScoreBaseSchema, type ScoreInput } from "jinglescript/browser";
import { describe, expect, it } from "vitest";
import { formatScore } from "../playground/editor/format-score.ts";
import { EMPTY_HISTORY, record, redo, undo } from "../playground/editor/history.ts";
import {
  addNote,
  addTrack,
  anchorSeconds,
  atForSeconds,
  atInForm,
  canRemoveNote,
  cueForSeconds,
  cueUses,
  duplicateNote,
  formOf,
  freshCueName,
  isScoreInput,
  moveNote,
  removeCue,
  removeNote,
  setCue,
  snappedSeconds,
  templateNote,
  transpose,
  type AtInput,
  type TimeContext,
} from "../playground/editor/score-edit.ts";
import { beatLines, timelineBlocks } from "../playground/editor/timeline-layout.ts";

const EXAMPLES_DIR = new URL("../../examples/", import.meta.url);
const exampleFiles = [
  ...readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json")),
  ...readdirSync(new URL("piano/", EXAMPLES_DIR))
    .filter((f) => f.endsWith(".json"))
    .map((f) => `piano/${f}`),
];

function loadExample(file: string): ScoreInput {
  const value: unknown = JSON.parse(readFileSync(new URL(file, EXAMPLES_DIR), "utf8"));
  if (!isScoreInput(value)) throw new Error(`${file} is not a score`);
  return value;
}

const examples = exampleFiles.map((file) => ({ file, score: loadExample(file) }));
const small = examples.filter(({ file }) => !file.startsWith("piano/"));

function expand(score: ScoreInput) {
  return expandScore(ScoreBaseSchema.parse(score));
}

/** A seeded generator (mulberry32), so a failure names the inputs that made it. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261015;
const GRIDS = [1, 0.5, 0.25, 0.125, undefined];

describe("formatScore", () => {
  it.each(exampleFiles)("%s reads back as the same score", (file) => {
    const score = loadExample(file);
    expect(JSON.parse(formatScore(score))).toEqual(score);
  });

  it("keeps a short note on one line and opens up what does not fit", () => {
    const text = formatScore(loadExample("hatena-marumo-a.json"));
    expect(text).toContain('        { "at": 0, "pitch": "G4", "vel": 0.8, "pan": 0.4 },\n');
    expect(text.startsWith('{\n  "$schema"')).toBe(true);
    expect(text.split("\n").every((line) => line.length <= 120)).toBe(true);
  });

  it("round-trips generated JSON values", () => {
    const random = seeded(SEED);
    const value = (depth: number): unknown => {
      const pick = random();
      if (depth > 3 || pick < 0.3) return [null, true, 1.25, -3, 'a"b', ""][Math.floor(random() * 6)];
      if (pick < 0.65) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
      return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, i) => [`k${i}`, value(depth + 1)]));
    };
    Array.from({ length: 300 }, () => value(0)).forEach((v) => expect(JSON.parse(formatScore(v))).toEqual(JSON.parse(JSON.stringify(v))));
  });
});

describe("atForSeconds keeps the form and lands on the grid", () => {
  const cues = { hit: 1.5, late: 3 };
  const forms = (): AtInput[] => [0.5, { seconds: 0.86 }, "hit", "hit+1", "late-0.5"];

  it("for generated targets, tempos and grids", () => {
    const random = seeded(SEED);
    let checked = 0;
    Array.from({ length: 400 }).forEach(() => {
      const tempo = 60 + Math.floor(random() * 120);
      const gridBeats = GRIDS[Math.floor(random() * GRIDS.length)];
      const context: TimeContext = { tempo, cues, gridBeats };
      const target = random() * 6 - 0.5;
      forms().forEach((at) => {
        const moved = atForSeconds(at, target, context);
        expect(formOf(moved)).toBe(formOf(at));
        expect(AtSchema.safeParse(moved).success).toBe(true);
        if (typeof at === "string") expect(parseCueRef(String(moved))?.cue).toBe(parseCueRef(at)?.cue);
        const landed = snappedSeconds(at, target, context);
        expect(landed).toBeGreaterThanOrEqual(-1e-9);
        // Beats and cue offsets snap to the beat grid; seconds to 10 ms (1 ms with the grid off).
        const step = formOf(at) === "seconds" ? (gridBeats === undefined ? 0.001 : 0.01) : ((gridBeats ?? 0) * 60) / tempo;
        const clamped = Math.max(0, target);
        expect(Math.abs(landed - clamped)).toBeLessThanOrEqual(step / 2 + 1e-6 + (formOf(at) === "cue" && clamped < step ? step : 0));
        checked++;
      });
    });
    expect(checked).toBe(2000);
  });

  it("writes cue offsets as the schema spells them", () => {
    const context: TimeContext = { tempo: 120, cues, gridBeats: 0.25 };
    expect(atForSeconds("hit", 1.5, context)).toBe("hit");
    expect(atForSeconds("hit", 2, context)).toBe("hit+1");
    expect(atForSeconds("hit+2", 1.25, context)).toBe("hit-0.5");
    expect(atForSeconds("hit", 0, context)).toBe("hit-3");
    expect(atForSeconds("hit", -1, context)).toBe("hit-3");
    expect(atForSeconds("nowhere+1", 2, context)).toBe("nowhere+1");
  });

  it("never puts a cue offset before the start, even where the grid would", () => {
    // 0.3 s is 0.6 of a beat: the nearest whole beat before the cue is at -0.2 s.
    const context: TimeContext = { tempo: 120, cues: { early: 0.3 }, gridBeats: 1 };
    expect(atForSeconds("early", 0, context)).toBe("early");
    expect(atForSeconds("early", 0, { ...context, gridBeats: undefined })).toBe("early-0.6");
  });

  it("converts between forms at the same time", () => {
    const context: TimeContext = { tempo: 120, cues, gridBeats: 0.25 };
    expect(atInForm("beats", 2, context)).toBe(4);
    expect(atInForm("seconds", 2, context)).toEqual({ seconds: 2 });
    expect(atInForm("cue", 2, context, "late")).toBe("late-2");
    expect(cueForSeconds({ beats: 2 }, 2.1, context)).toEqual({ beats: 4.25 });
    expect(cueForSeconds({ seconds: 1 }, 2.1234, context)).toEqual({ seconds: 2.12 });
  });
});

describe("moveNote, checked by expandScore", () => {
  it.each(small.map((e) => e.file))("%s: each note lands where the drag showed, and nothing else moves", (file) => {
    const score = loadExample(file);
    const before = expand(score);
    const random = seeded(SEED + file.length);
    before.events
      .filter((e) => e.repeat === 0)
      .forEach((event) => {
        const ref = { track: event.track, note: event.note };
        const note = score.tracks[ref.track]?.notes[ref.note];
        if (note === undefined) throw new Error("no note");
        const context: TimeContext = { tempo: score.tempo, cues: before.cues, gridBeats: GRIDS[Math.floor(random() * GRIDS.length)] };
        const target = random() * before.duration * 0.8;
        const shown = snappedSeconds(note.end ?? note.at ?? 0, target, context, note.end === undefined ? 0 : event.hold);
        const after = expand(moveNote(score, ref, target, context));
        const moved = after.events.find((e) => e.track === ref.track && e.note === ref.note && e.repeat === 0);
        if (moved === undefined) return; // moved past the end, which expandScore reports
        expect(anchorSeconds(note, moved)).toBeCloseTo(shown, 6);
        const others = (events: typeof before.events) =>
          events.filter((e) => e.track !== ref.track || e.note !== ref.note).map((e) => [e.track, e.note, e.repeat, e.nominal]);
        expect(others(after.events)).toEqual(others(before.events));
      });
  });
});

describe("adding, duplicating and removing", () => {
  it.each(small.map((e) => e.file))("%s: a sound added on each track, copying the one before it, still checks", (file) => {
    const score = loadExample(file);
    const expanded = expand(score);
    const context: TimeContext = { tempo: score.tempo, cues: expanded.cues, gridBeats: 0.25 };
    score.tracks.forEach((_, track) => {
      const at = expanded.duration / 3;
      const template = templateNote(score, track, expanded.events, at);
      if (template === undefined) throw new Error("no template");
      const added = addNote(score, track, at, template, context);
      const check = checkScore(added.score);
      expect(check.ok ? [] : check.errors).toEqual([]);
      const event = expand(added.score).events.find((e) => e.track === track && e.note === added.ref.note);
      expect(event?.nominal).toBeCloseTo(snappedSeconds(0, at, context), 6);
      expect(event?.repeat).toBe(0);
    });
  });

  it("a new sound copies the latest one that starts by its time, else the track's first", () => {
    const score: ScoreInput = {
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 4 },
      tracks: [
        {
          instrument: "marimba",
          notes: [
            { at: 4, pitch: "G5" },
            { at: 2, pitch: "E5" },
            { at: 0, pitch: "C5" },
          ],
        },
      ],
    };
    const events = expand(score).events;
    expect(templateNote(score, 0, events, 1.2)?.pitch).toBe("E5");
    expect(templateNote(score, 0, events, 0.5)?.pitch).toBe("C5");
    expect(templateNote(score, 0, events, 3)?.pitch).toBe("G5");
  });

  it("the copy plays what its template plays, without its time, repeats or lyric", () => {
    const score: ScoreInput = {
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 4 },
      tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "E5", vel: 0.6, lyric: "ハ", repeat: { every: 1, count: 2 } }] }],
    };
    const added = addNote(
      score,
      0,
      2,
      { at: 0, pitch: "E5", vel: 0.6, lyric: "ハ", repeat: { every: 1, count: 2 } },
      { tempo: 120, cues: {}, gridBeats: 0.25 },
    );
    expect(added.score.tracks[0]?.notes[1]).toEqual({ at: 4, pitch: "E5", vel: 0.6 });
    const copy = duplicateNote(score, { track: 0, note: 0 }, 1, { tempo: 120, cues: {}, gridBeats: 0.25 });
    expect(copy.score.tracks[0]?.notes[1]).toEqual({ at: 2, pitch: "E5", vel: 0.6, repeat: { every: 1, count: 2 } });
  });

  it("removing a track's last note removes the track, and the score's last note stays", () => {
    const one: ScoreInput = {
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 2 },
      tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
    };
    expect(canRemoveNote(one, { track: 0, note: 0 })).toBe(false);
    expect(removeNote(one, { track: 0, note: 0 })).toBe(one);
    const two = addTrack(one, "clap", undefined);
    expect(removeNote(two, { track: 1, note: 0 }).tracks).toHaveLength(1);
  });

  it("a new track of every built-in starts with a note that checks", () => {
    const base = loadExample("hatena-marumo-a.json");
    const instruments = expand(base).instruments;
    [...instruments.keys()].forEach((name) => {
      const check = checkScore(addTrack(base, name, instruments.get(name)?.descriptor));
      expect([name, check.ok ? [] : check.errors]).toEqual([name, []]);
    });
  });
});

describe("transpose", () => {
  it("moves pitches, chords' pitches and chord roots", () => {
    expect(transpose({ at: 0, pitch: "C4" }, 1)).toEqual({ at: 0, pitch: "C#4" });
    expect(transpose({ at: 0, pitch: "B4" }, 1)).toEqual({ at: 0, pitch: "C5" });
    expect(transpose({ at: 0, pitch: "Bb3" }, -12)).toEqual({ at: 0, pitch: "A#2" });
    expect(transpose({ at: 0, pitch: ["C4", "E4"] }, 2)).toEqual({ at: 0, pitch: ["D4", "F#4"] });
    expect(transpose({ at: 0, chord: "Am7" }, 2)).toEqual({ at: 0, chord: "Bm7" });
    expect(transpose({ at: 0, chord: "C" }, -1)).toEqual({ at: 0, chord: "B" });
    expect(transpose({ at: 0, variant: "metal" }, 1)).toEqual({ at: 0, variant: "metal" });
  });
});

describe("cues", () => {
  const score = loadExample("hatena-marumo-a.json");

  it("counts uses and keeps a cue in use", () => {
    expect(cueUses(score, "hit")).toBe(3);
    expect(cueUses(score, "voice")).toBe(0);
    expect(removeCue(score, "hit")).toBe(score);
    expect(Object.keys(removeCue(score, "voice").cues ?? {})).toEqual(["hit"]);
  });

  it("moving a cue moves the notes on it", () => {
    const moved = expand(setCue(score, "hit", { seconds: 2 }));
    const onHit = moved.events.filter((e) => e.cue === "hit");
    expect(onHit.length).toBeGreaterThan(0);
    onHit.forEach((e) => expect(e.nominal).toBe(2));
  });

  it("names a new cue without taking an existing name", () => {
    expect(freshCueName(score, "cue")).toBe("cue");
    expect(freshCueName(setCue(score, "cue", { seconds: 1 }), "cue")).toBe("cue2");
  });
});

describe("timeline layout", () => {
  it.each(examples.map((e) => e.file))("%s: one block per event, at its written onset", (file) => {
    const expanded = expand(loadExample(file));
    const blocks = timelineBlocks(expanded);
    expect(blocks.map((b) => [b.track, b.note, b.repeat, b.start])).toEqual(expanded.events.map((e) => [e.track, e.note, e.repeat, e.nominal]));
    blocks.forEach((b) => {
      expect(b.height).toBeGreaterThanOrEqual(0);
      expect(b.height).toBeLessThanOrEqual(1);
    });
  });

  it("beat lines every beat, a bar every four", () => {
    expect(beatLines(120, 2.1)).toEqual([0, 0.5, 1, 1.5, 2].map((seconds, i) => ({ seconds, bar: i % 4 === 0 })));
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit clears what could be redone", () => {
    const first = record(EMPTY_HISTORY, "a");
    const back = undo(first, "b");
    expect(back?.text).toBe("a");
    const forward = redo(back?.history ?? EMPTY_HISTORY, "a");
    expect(forward?.text).toBe("b");
    expect(record(back?.history ?? EMPTY_HISTORY, "a").future).toEqual([]);
    expect(undo(EMPTY_HISTORY, "x")).toBeUndefined();
    expect(redo(EMPTY_HISTORY, "x")).toBeUndefined();
  });
});
