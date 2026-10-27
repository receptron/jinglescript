import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScore, getSchema, JingleScriptError, parseScore, SCHEMA_PARTS } from "../src/index.ts";
import { expandScore } from "../src/events.ts";
import { pitchToMidi } from "../src/pitch.ts";
import { withGuide } from "../src/readme.ts";
import { SCHEMA_FILES, schemaFileText } from "../src/schema-files.ts";
import { parseCueRef, resolveAt } from "../src/time.ts";

const base = {
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 4 },
  cues: { hit: { seconds: 1.5 } },
  tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
};
const withNotes = (notes: unknown[], extra: Record<string, unknown> = {}) => ({ ...base, ...extra, tracks: [{ instrument: "marimba", notes }] });
const errorsOf = (input: unknown) => checkScore(input).errors;

describe("pitch and time", () => {
  it("reads scientific pitch notation", () => {
    expect(pitchToMidi("C4")).toBe(60);
    expect(pitchToMidi("A4")).toBe(69);
    expect(pitchToMidi("F#3")).toBe(54);
    expect(pitchToMidi("Bb5")).toBe(82);
    expect(pitchToMidi("H4")).toBeUndefined();
  });

  it("reads cue references with beat offsets", () => {
    expect(parseCueRef("hit")).toEqual({ cue: "hit", offsetBeats: 0 });
    expect(parseCueRef("hit+1")).toEqual({ cue: "hit", offsetBeats: 1 });
    expect(parseCueRef("hit-0.25")).toEqual({ cue: "hit", offsetBeats: -0.25 });
    expect(parseCueRef("Hit")).toBeUndefined();
  });

  it("resolves every form of `at` to seconds", () => {
    const cues = { hit: 1.5 };
    expect(resolveAt(1, 120, cues)).toEqual({ ok: true, seconds: 0.5, cue: undefined });
    expect(resolveAt({ seconds: 0.86 }, 120, cues)).toEqual({ ok: true, seconds: 0.86, cue: undefined });
    expect(resolveAt("hit", 120, cues)).toEqual({ ok: true, seconds: 1.5, cue: "hit" });
    expect(resolveAt("hit-1", 120, cues)).toEqual({ ok: true, seconds: 1, cue: undefined });
    expect(resolveAt("miss", 120, cues)).toEqual({ ok: false, unknownCue: "miss" });
  });
});

describe("score validation (errors written for repair)", () => {
  it("accepts the shipped example", () => {
    const example: unknown = JSON.parse(readFileSync(new URL("../examples/hatena-marumo-a.json", import.meta.url), "utf8"));
    expect(checkScore(example)).toMatchObject({ ok: true, errors: [], cues: { hit: { seconds: 1.5, beat: 3.25 }, voice: { seconds: 1.8 } } });
  });

  it("names an unknown cue and lists the defined ones", () => {
    expect(errorsOf(withNotes([{ at: "hti", pitch: "C5" }]))).toEqual([
      { path: "tracks[0].notes[0].at", message: 'Unknown cue "hti".', hint: "Defined cues: hit." },
    ]);
  });

  it("lists the instruments when one is unknown", () => {
    const [error] = errorsOf({ ...base, tracks: [{ instrument: "kazoo", notes: [{ at: 0 }] }] });
    expect(error?.path).toBe("tracks[0].instrument");
    expect(error?.message).toBe('Unknown instrument "kazoo".');
    expect(error?.hint).toContain("marimba");
  });

  it("says a removed instrument is gone and names the one to use", () => {
    const [error] = errorsOf({ ...base, tracks: [{ instrument: "piano", notes: [{ at: 0, pitch: "C4" }] }] });
    expect(error).toMatchObject({ path: "tracks[0].instrument", message: '"piano" was removed in 0.11.0; use "grandpiano" instead.' });
    // A score may still define its own "piano".
    const own = checkScore({ ...base, instruments: { piano: { base: "marimba" } }, tracks: [{ instrument: "piano", notes: [{ at: 0, pitch: "C4" }] }] });
    expect(own.errors).toEqual([]);
  });

  it("rejects unknown fields", () => {
    expect(errorsOf({ ...base, tempoo: 120 })).toContainEqual(expect.objectContaining({ message: 'Unknown field "tempoo".' }));
  });

  it("needs a pitch on pitched instruments and keeps it in range", () => {
    expect(errorsOf(withNotes([{ at: 0 }]))[0]?.message).toContain("needs a pitch");
    expect(errorsOf(withNotes([{ at: 0, pitch: ["C5", "C8"] }]))).toEqual([
      { path: "tracks[0].notes[0].pitch[1]", message: "C8 is outside marimba's range.", hint: "Use C2–C7; move it by an octave." },
    ]);
  });

  it("rejects malformed pitches and times with the allowed forms", () => {
    expect(errorsOf(withNotes([{ at: 0, pitch: "C" }]))[0]?.message).toContain('"C4" (middle C)');
    expect(errorsOf(withNotes([{ at: "1.5s", pitch: "C5" }]))[0]?.message).toContain('{ "seconds": 0.86 }');
  });

  it("rejects notes and cues after the end", () => {
    expect(errorsOf(withNotes([{ at: { seconds: 4 }, pitch: "C5" }]))[0]?.message).toContain("at or after the end");
    expect(errorsOf({ ...base, cues: { late: { seconds: 5 } } })[0]).toMatchObject({ path: "cues.late" });
  });

  it("reports a strum that overruns the end once, by its stroke and how long its pattern plays", () => {
    const ukulele = { ...base, tracks: [{ instrument: "ukulele", notes: [{ at: 6, chord: "Am", len: 1, strum: "d-u-ud-u" }] }] };
    const errors = errorsOf(ukulele);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Stroke 3 of this note\'s strum pattern "d-u-ud-u"');
    expect(errors[0]?.hint).toContain('"d-u-ud-u" lasts 4 beats');
  });

  it("reports only the first repetition of a note that runs past the end", () => {
    const errors = errorsOf(withNotes([{ at: 0, pitch: "C5", repeat: { every: 1, count: 20 } }]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/^Repetition \d+ of this note starts at/);
  });

  it("requires exactly one of repeat.count and repeat.until", () => {
    expect(errorsOf(withNotes([{ at: 0, pitch: "C5", repeat: { every: 1 } }]))[0]?.message).toBe("Give exactly one of `count` or `until`.");
  });

  it("parseScore throws every problem at once", () => {
    expect(() => parseScore({ ...base, tempo: "fast", tracks: [] })).toThrow(JingleScriptError);
    try {
      parseScore({ ...base, tempo: "fast", tracks: [] });
    } catch (error) {
      expect(error instanceof JingleScriptError && error.problems.map((p) => p.path)).toEqual(["tempo", "tracks"]);
    }
  });

  it("warns about a note a few ms off a cue", () => {
    const result = checkScore(withNotes([{ at: { seconds: 1.505 }, pitch: "C5" }]));
    expect(result.ok).toBe(true);
    expect(result.warnings[0]?.hint).toBe('If it belongs to the cue, write "at": "hit".');
  });
});

describe("expansion", () => {
  it("expands repeats up to and including `until`, cycling variants", () => {
    const { events } = expandScore(parseScore(withNotes([{ at: 0, pitch: "C5", repeat: { every: 1, until: "hit" } }])));
    expect(events.map((e) => e.seconds)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("humanizes notes, but never one placed on a cue", () => {
    const { events } = expandScore(
      parseScore(
        withNotes([
          { at: 1, pitch: "C5", humanize: 20 },
          { at: "hit", pitch: "C5", humanize: 20 },
        ]),
      ),
    );
    expect(events[0]?.seconds).not.toBe(0.5);
    expect(Math.abs((events[0]?.seconds ?? 0) - 0.5)).toBeLessThanOrEqual(0.02);
    expect(events[1]).toMatchObject({ seconds: 1.5, cue: "hit" });
  });

  it("holds sustained notes until the next onset, minus a gap", () => {
    const { events } = expandScore(
      parseScore(
        withNotes([
          { at: 0, pitch: "C5" },
          { at: 1, pitch: "D5" },
          { at: 2, pitch: "E5", len: 1 },
        ]),
      ),
    );
    expect(events.map((e) => e.hold)).toEqual([0.46, 0.46, 0.5]);
  });
});

describe("API for LLMs", () => {
  it("serves the JSON Schema of every part", () => {
    for (const part of SCHEMA_PARTS) expect(getSchema(part)).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema" });
    expect(JSON.stringify(getSchema())).toContain("Wooden bar struck with a soft mallet");
  });

  it("keeps the README's guide section current (run `npm run readme`)", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).toBe(withGuide(readme));
  });

  it("keeps the published schema files current (run `npm run schema`)", () => {
    for (const [file, part] of Object.entries(SCHEMA_FILES)) {
      expect(readFileSync(new URL(`../schema/${file}`, import.meta.url), "utf8")).toBe(schemaFileText(part));
    }
  });
});

describe("pedal", () => {
  const piano = (pedal: unknown[], instrument = "grandpiano") =>
    errorsOf({
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 4 },
      cues: { hit: { seconds: 1 } },
      tracks: [{ instrument, notes: [{ at: 0, pitch: "C4", len: 1 }], pedal }],
    });

  it("accepts stretches in time order, touching where the pedal changes", () => {
    expect(
      piano([
        { at: 0, until: 2 },
        { at: 2, until: "hit+2" },
        { at: { seconds: 3 }, until: { seconds: 4 } },
      ]),
    ).toEqual([]);
  });

  it("says what is wrong with a pedal, and where", () => {
    expect(piano([{ at: 0, until: 2 }], "marimba")).toMatchObject([{ path: "tracks[0].pedal", message: expect.stringContaining("no dampers") }]);
    expect(piano([{ at: 2, until: 2 }])).toMatchObject([{ path: "tracks[0].pedal[0].until", message: expect.stringContaining("not after") }]);
    expect(
      piano([
        { at: 0, until: 3 },
        { at: 2, until: 4 },
      ]),
    ).toMatchObject([{ path: "tracks[0].pedal[1].at", message: expect.stringContaining("before the previous") }]);
    expect(piano([{ at: 0, until: 9 }])).toMatchObject([{ path: "tracks[0].pedal[0].until", message: expect.stringContaining("after the end") }]);
    expect(piano([{ at: "drop", until: 2 }])).toMatchObject([{ path: "tracks[0].pedal[0].at" }]);
    expect(piano([{ at: "hit-3", until: 2 }])).toMatchObject([{ path: "tracks[0].pedal[0].at", message: expect.stringContaining("before 0 s") }]);
  });
});
