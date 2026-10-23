import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spellChordTone } from "../src/chords.ts";
import { manage, ManageInputSchema } from "../src/manage.ts";
import { KEYS, parseKey, parseMeter } from "../src/meter.ts";
import { notationToMusicXml, scoreToMusicXml } from "../src/musicxml.ts";
import { scoreToNotation, snap, type Notation, type NotationItem } from "../src/notation.ts";
import { checkScore, parseScore } from "../src/score.ts";
import { toPlayerData } from "../src/player.ts";
import { render } from "../src/render.ts";
import { fixtureSamples } from "./sample-fixture.ts";

type ScoreJson = Record<string, unknown>;

const base = (fields: ScoreJson, tracks: unknown[]): ScoreJson => ({ format: "jinglescript/1", tempo: 120, length: { beats: 16 }, ...fields, tracks });
const melody = (notes: unknown[], extra: ScoreJson = {}) => ({ instrument: "grandpiano", notes, ...extra });
const notationOf = (fields: ScoreJson, tracks: unknown[]): Notation => {
  const notation = scoreToNotation(parseScore(base(fields, tracks)));
  if (notation === undefined) throw new Error("no notation");
  return notation;
};

/** A staff's bars as short text: "C4:q D4:8. r:16", "~" marking a tie onward, "3" a triplet. */
function bars(notation: Notation, part = 0, staff = 0): string[] {
  const label = (item: NotationItem): string => {
    const accidental: Record<number, string> = { 1: "#", 0: "", [-1]: "b", [-2]: "bb" };
    const pitches = item.pitches.map((p) => `${p.step}${accidental[p.alter] ?? "?"}${p.octave}`).join("+") || "r";
    if (item.measureRest) return "R";
    const short = { whole: "w", half: "h", quarter: "q", eighth: "8", "16th": "16", "32nd": "32" }[item.value?.type ?? "quarter"];
    return `${pitches}:${short}${".".repeat(item.value?.dots ?? 0)}${item.value?.triplet ? "3" : ""}${item.tieStart ? "~" : ""}`;
  };
  return notation.parts[part]?.staves[staff]?.measures.map((m) => m.map(label).join(" ")) ?? [];
}

const examples = readdirSync(new URL("../examples/", import.meta.url)).filter((f) => f.startsWith("learn-"));
const example = (name: string): ScoreJson => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")) as ScoreJson;

describe("meter and key", () => {
  it("reads time signatures and refuses others", () => {
    expect(parseMeter("6/8")).toEqual({ beats: 6, beatType: 8 });
    expect(parseMeter("4/3")).toBeUndefined();
    expect(parseMeter("0/4")).toBeUndefined();
  });

  it("gives each key its signature, majors and minors, up to seven accidentals", () => {
    expect(parseKey("C")).toEqual({ fifths: 0, mode: "major" });
    expect(parseKey("Bb")).toEqual({ fifths: -2, mode: "major" });
    expect(parseKey("F#m")).toEqual({ fifths: 3, mode: "minor" });
    expect(parseKey("Ebm")).toEqual({ fifths: -6, mode: "minor" });
    expect(parseKey("G#")).toBeUndefined();
    expect(KEYS).toHaveLength(30);
  });

  it("rejects a bad meter, a key with too many sharps, and a pickup of a whole bar, with a hint", () => {
    const check = checkScore(base({ meter: "3/4", key: "D#", pickup: 3 }, [melody([{ at: 0, pitch: "C4" }])]));
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.path).sort()).toEqual(["key", "pickup"]);
    expect(check.errors.find((e) => e.path === "pickup")?.message).toContain("a bar of 3/4 is 3");
    expect(checkScore(base({ meter: "5/3" }, [melody([{ at: 0, pitch: "C4" }])])).errors[0]?.message).toContain('"6/8"');
  });
});

describe("render options written into the score", () => {
  it("say where they belong", () => {
    const check = checkScore({ ...base({}, [melody([{ at: 0, pitch: "C4" }])]), view: "notation", autoplay: true, autoplayDelay: 2 });
    expect(check.errors).toEqual([
      {
        path: "",
        message: 'Unknown fields "view", "autoplay", "autoplayDelay".',
        hint: "view, autoplay, autoplayDelay and notifyWhenDone are options of the renderScore call, next to `score` — not fields of the score. Remove them from the score.",
      },
    ]);
  });
});

describe("scoreToNotation", () => {
  it("writes quarter notes into bars and fills the last one with rests", () => {
    const notation = notationOf({}, [melody([0, 1, 2, 3, 4].map((at) => ({ at, pitch: "C4", len: 1 })))]);
    expect(bars(notation)).toEqual(["C4:q C4:q C4:q C4:q", "C4:q r:q r:h"]);
    expect(notation.measures.map((m) => m.number)).toEqual([1, 2]);
  });

  it("writes a note up to the next one when it has no len, and the last one to the end of its bar", () => {
    expect(
      bars(
        notationOf({}, [
          melody([
            { at: 0, pitch: "C4" },
            { at: 3, pitch: "D4" },
          ]),
        ]),
      ),
    ).toEqual(["C4:h. D4:q"]);
    expect(
      bars(
        notationOf({}, [
          melody([
            { at: 0, pitch: "C4" },
            { at: 1, pitch: "D4" },
          ]),
        ]),
      ),
    ).toEqual(["C4:q D4:h."]);
  });

  it("ties a note across the bar line", () => {
    expect(bars(notationOf({}, [melody([{ at: 2, pitch: "E4", len: 4 }])]))).toEqual(["r:h E4:h~", "E4:h r:h"]);
  });

  it("dots a value that starts on a beat in simple time, and keeps the dotted beat in 6/8", () => {
    const dotted = [
      { at: 0, pitch: "G4", len: 1.5 },
      { at: 1.5, pitch: "G4", len: 0.5 },
      { at: 2, pitch: "G4", len: 2 },
    ];
    expect(bars(notationOf({}, [melody(dotted)]))).toEqual(["G4:q. G4:8 G4:h"]);
    const compound = [
      { at: 0, pitch: "C4", len: 2 },
      { at: 2, pitch: "D4", len: 1 },
    ];
    expect(bars(notationOf({ meter: "6/8" }, [melody(compound)]))).toEqual(["C4:q.~ C4:8 D4:q"]);
  });

  it("brackets triplets and rounds their thirds onto the grid without a warning", () => {
    const notation = notationOf({}, [melody([0, 0.333, 0.667, 1].map((at, i) => ({ at, pitch: "A4", len: i < 3 ? 0.333 : 3 })))]);
    expect(bars(notation)).toEqual(["A4:83 A4:83 A4:83 A4:h."]);
    const items = notation.parts[0]?.staves[0]?.measures[0] ?? [];
    expect(items.map((i) => i.tuplet)).toEqual(["start", undefined, "stop", undefined]);
    expect(notation.warnings).toEqual([]);
  });

  it("writes triplets in 2/2 too; in 6/8 it puts triplet times on the straight grid and says so", () => {
    const triplet = [0, 0.333, 0.667].map((at, i) => ({ at, pitch: ["C4", "D4", "E4"][i], len: 0.333 }));
    const cut = notationOf({ meter: "2/2" }, [melody([{ at: 0, pitch: "G4", len: 1 }, ...triplet.map((n) => ({ ...n, at: n.at + 1 }))])]);
    expect(bars(cut)).toEqual(["G4:q C4:83 D4:83 E4:83 r:h"]);
    expect(cut.warnings).toEqual([]);
    const compound = notationOf({ meter: "6/8" }, [melody(triplet)]);
    const items = compound.parts[0]?.staves[0]?.measures[0] ?? [];
    expect(items.every((i) => i.duration % 3 === 0 && !i.value?.triplet)).toBe(true);
    expect(compound.warnings.map((w) => w.path.join("."))).toEqual([
      "tracks.0.notes.0.len",
      "tracks.0.notes.1.at",
      "tracks.0.notes.1.len",
      "tracks.0.notes.2.at",
    ]);
    expect(compound.warnings[0]?.message).toContain("this meter writes no triplets");
  });

  it("fills every bar exactly, a pickup of triplets included", () => {
    for (const pickup of [0.333, 0.667, 0.5, 1.333]) {
      const notation = notationOf({ pickup }, [melody([0, 0.333, 0.667, 1, 1.333, 1.667].map((at) => ({ at, pitch: "C4", len: 0.333 })))]);
      const staff = notation.parts[0]?.staves[0]?.measures ?? [];
      expect(staff.map((items) => items.reduce((sum, i) => sum + i.duration, 0))).toEqual(notation.measures.map((m) => m.length));
    }
  });

  it("fills every bar exactly, whatever the rhythm rounds to", () => {
    // Deterministic rhythms from straight, triplet and off-grid steps, in every meter and with pickups.
    const steps = [0.125, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.5, 0.1, 0.29, 0.167];
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (const meter of ["4/4", "3/4", "2/4", "2/2", "6/8", "3/8", "9/8", "5/4"]) {
      for (let round = 0; round < 24; round++) {
        let at = 0;
        const notes = [];
        while (at < 8) {
          at += next(3) === 0 ? (steps[next(steps.length)] ?? 0.5) : 0;
          notes.push({ at, pitch: "C4", len: steps[next(steps.length)] ?? 1 });
          at += steps[next(steps.length)] ?? 1;
        }
        // Every pickup in every meter, four rhythms each.
        const pickup = [undefined, 0.333, 0.5, 1, 0.25, 0.667][round % 6];
        const notation = notationOf({ meter, ...(pickup === undefined ? {} : { pickup }), length: { beats: 12 } }, [melody(notes)]);
        const bars = notation.parts[0]?.staves[0]?.measures ?? [];
        expect(bars.map((items) => items.reduce((sum, i) => sum + i.duration, 0))).toEqual(notation.measures.map((m) => m.length));
        expect(bars.flat().every((i) => i.duration > 0 && i.start >= 0)).toBe(true);
      }
    }
  });

  it("writes a pickup of a quarter's part next to triplets straight, filling it exactly", () => {
    const notation = notationOf({ pickup: 0.25 }, [
      melody([
        { at: 4 / 24, pitch: "C4", len: 1 / 3 },
        { at: 16 / 24, pitch: "D4", len: 0.5 },
      ]),
    ]);
    const staff = notation.parts[0]?.staves[0]?.measures ?? [];
    expect(staff.map((items) => items.reduce((sum, i) => sum + i.duration, 0))).toEqual(notation.measures.map((m) => m.length));
    expect(notation.warnings.length).toBeGreaterThan(0);
  });

  it("reports a pickup it rounds: off the grid, or a triplet length in 6/8; not a triplet pickup in 4/4", () => {
    const note = [melody([{ at: 0, pitch: "C4", len: 0.25 }])];
    expect(notationOf({ pickup: 0.29 }, note).warnings.map((w) => w.path.join("."))).toEqual(["pickup"]);
    expect(notationOf({ meter: "6/8", pickup: 0.333 }, note).warnings[0]?.message).toContain("6/8 writes no triplets");
    expect(notationOf({ pickup: 0.333 }, note).warnings.filter((w) => w.path[0] === "pickup")).toEqual([]);
  });

  it("warns when a quarter note mixes straight notes with triplets", () => {
    const notation = notationOf({}, [
      melody([
        { at: 0, pitch: "C4", len: 0.25 },
        { at: 0.25, pitch: "D4", len: 0.25 },
        { at: 0.5, pitch: "E4", len: 0.333 },
        { at: 0.833, pitch: "F4", len: 0.167 },
      ]),
    ]);
    expect(notation.warnings.map((w) => w.path.join("."))).toEqual(["tracks.0.notes.0.len", "tracks.0.notes.1.at"]);
    expect(notation.warnings[1]?.message).toContain("also has triplets; written at beat 0.333");
  });

  it("starts with a pickup bar, numbered 0, and counts its beats back from the bar's end", () => {
    const notation = notationOf({ meter: "3/4", pickup: 1 }, [
      melody([
        { at: 0, pitch: "C4", len: 0.75 },
        { at: 0.75, pitch: "C4", len: 0.25 },
        { at: 1, pitch: "D4", len: 3 },
      ]),
    ]);
    expect(notation.measures.map((m) => [m.number, m.length, m.implicit])).toEqual([
      [0, 24, true],
      [1, 72, false],
    ]);
    expect(bars(notation)).toEqual(["C4:8. C4:16", "D4:h."]);
  });

  it("warns, with the note's path, about a time off the grid and a note held into the next", () => {
    const notation = notationOf({}, [
      melody([
        { at: 0, pitch: "C4", len: 2 },
        { at: 1, pitch: "D4", len: 1 },
        { at: { seconds: 1.04 }, pitch: "E4" },
      ]),
    ]);
    expect(notation.warnings.map((w) => w.path.join("."))).toEqual(["tracks.0.notes.2.at", "tracks.0.notes.0.len"]);
    expect(notation.warnings[0]?.message).toContain("off the sheet-music grid");
  });

  it("warns about a len off the grid, and not about a triplet's 0.333", () => {
    const notation = notationOf({}, [
      melody([
        { at: 0, pitch: "C4", len: 0.29 },
        { at: 1, pitch: "D4", len: 0.333 },
      ]),
    ]);
    expect(notation.warnings.map((w) => w.path.join("."))).toEqual(["tracks.0.notes.0.len"]);
    expect(notation.warnings[0]?.message).toContain("written as 0.25");
  });

  it("warns once when notes that start together have different lengths, and a repeat does not warn again", () => {
    const together = [
      { at: 0, pitch: "C4", len: 1 },
      { at: 0, pitch: "E4", len: 2 },
    ];
    expect(notationOf({}, [melody(together)]).warnings.map((w) => w.path.join("."))).toEqual(["tracks.0.notes.0.len"]);
    const mixed = [
      { at: 0, pitch: "C4", len: 0.25 },
      { at: 0.25, pitch: "D4", len: 0.25 },
      { at: 0.5, pitch: "E4", len: 0.333 },
    ];
    const repeated = notationOf({}, [melody(mixed.map((n) => ({ ...n, repeat: { every: 1, count: 3 } })))]);
    expect(repeated.warnings.map((w) => w.path.join("."))).toEqual(["tracks.0.notes.0.len", "tracks.0.notes.1.at"]);
  });

  it("joins lyrics in written order even when humanize swaps two notes in playback", () => {
    const notes = [
      { at: 1, pitch: "C4", len: 0.125, humanize: 50, lyric: "hap-" },
      { at: 1.125, pitch: "D4", len: 0.125, humanize: 50, lyric: "py" },
    ];
    const notation = notationOf({ tempo: 400, seed: 6 }, [melody(notes)]);
    const sung = (notation.parts[0]?.staves[0]?.measures ?? []).flat().filter((i) => i.lyric !== undefined);
    expect(sung.map((i) => i.lyric?.syllabic)).toEqual(["begin", "end"]);
  });

  it("writes notes at their written time, before humanize moves them", () => {
    const humanized = notationOf({}, [melody([0, 1, 2, 3].map((at) => ({ at, pitch: "C4", len: 1, humanize: 30 })))]);
    expect(bars(humanized)).toEqual(["C4:q C4:q C4:q C4:q"]);
    expect(humanized.warnings).toEqual([]);
  });

  it("prints accidentals against the key and the bar: once per bar, a natural to cancel, none on a tie", () => {
    const notation = notationOf({ key: "G" }, [
      melody([
        { at: 0, pitch: "F#4", len: 1 },
        { at: 1, pitch: "F4", len: 1 },
        { at: 2, pitch: "F4", len: 1 },
        { at: 3, pitch: "C#5", len: 2 },
      ]),
    ]);
    const measures = notation.parts[0]?.staves[0]?.measures ?? [];
    expect(measures.map((m) => m.map((i) => i.accidentals[0] ?? "-"))).toEqual([
      ["-", "natural", "-", "sharp"],
      ["-", "-", "-"],
    ]);
  });

  it("restates the accidental on a note after one tied over the bar line", () => {
    const notation = notationOf({}, [
      melody([
        { at: 3, pitch: "F#4", len: 2 },
        { at: 5, pitch: "F#4", len: 1 },
      ]),
    ]);
    const measures = notation.parts[0]?.staves[0]?.measures ?? [];
    expect(measures.map((m) => m.filter((i) => i.pitches.length > 0).map((i) => i.accidentals[0] ?? "-"))).toEqual([["sharp"], ["-", "sharp"]]);
  });

  it("spells a chord written by name from its root: C7's seventh is Bb, Cdim7's is Bbb", () => {
    expect(spellChordTone("C7", 70)).toEqual({ step: "B", alter: -1, octave: 4 });
    expect(spellChordTone("Cdim7", 69)).toEqual({ step: "B", alter: -2, octave: 4 });
    expect(spellChordTone("C#", 65)).toEqual({ step: "E", alter: 1, octave: 4 });
    expect(spellChordTone("C", 61)).toBeUndefined();
    const notation = notationOf({}, [melody([{ at: 0, chord: "C7", len: 4 }])]);
    expect(bars(notation)).toEqual(["C4+E4+G4+Bb4:w"]);
    expect(notation.parts[0]?.staves[0]?.measures[0]?.[0]?.harmony).toBe("C7");
  });

  it("puts a right and a left hand of one keyboard on a grand staff, and other tracks on parts of their own", () => {
    const notation = notationOf({}, [
      melody([{ at: 0, pitch: "E5", len: 4 }], { name: "right hand" }),
      melody([{ at: 0, pitch: ["C3", "G3"], len: 4 }], { name: "left hand" }),
      { instrument: "marimba", name: "bells", notes: [{ at: 0, pitch: "C3", len: 4 }] },
      { instrument: "clap", notes: [{ at: 0 }] },
      { instrument: "marimba", notation: false, notes: [{ at: 0, pitch: "G5" }] },
    ]);
    expect(notation.parts.map((p) => [p.name, p.tracks, p.staves.map((s) => s.clef)])).toEqual([
      ["Piano", [0, 1], ["treble", "bass"]],
      ["Bells", [2], ["bass"]],
    ]);
  });

  it("joins lyric syllables into words and holds one over the next note", () => {
    const notation = notationOf({}, [
      melody([
        { at: 0, pitch: "C4", len: 1, lyric: "hap-" },
        { at: 1, pitch: "D4", len: 1, lyric: "py" },
        { at: 2, pitch: "E4", len: 1, lyric: "day" },
        { at: 3, pitch: "F4", len: 1, lyric: "_" },
      ]),
    ]);
    const lyrics = notation.parts[0]?.staves[0]?.measures[0]?.map((i) => i.lyric) ?? [];
    expect(lyrics).toEqual([
      { text: "hap", syllabic: "begin", extend: false },
      { text: "py", syllabic: "end", extend: false },
      { text: "day", syllabic: "single", extend: true },
      undefined,
    ]);
  });

  it("leaves out sound effects that take a pitch, and keeps a custom pitched instrument", () => {
    const laser = parseScore(base({}, [{ instrument: "laser", notes: [{ at: 0, pitch: "C6" }] }]));
    expect(scoreToNotation(laser)).toBeUndefined();
    const custom = notationOf({ instruments: { bell: { base: "glockenspiel", transpose: 12 } } }, [
      { instrument: "bell", notes: [{ at: 0, pitch: "C5", len: 1 }] },
      { instrument: "laser", notes: [{ at: 1, pitch: "C6" }] },
    ]);
    expect(custom.parts.map((p) => p.tracks)).toEqual([[0]]);
  });

  it("has nothing to show for a score of sound effects only", () => {
    expect(scoreToNotation(parseScore(base({}, [{ instrument: "clap", notes: [{ at: 0 }] }])))).toBeUndefined();
    expect(scoreToMusicXml(parseScore(base({}, [{ instrument: "clap", notes: [{ at: 0 }] }])))).toBeUndefined();
  });
});

describe("MusicXML", () => {
  const xml = (name: string): string => scoreToMusicXml(parseScore(example(name))) ?? "";

  it("writes a partwise MusicXML 4.0 file with attributes, tempo, lyrics and a final bar line", () => {
    const text = xml("learn-happy-birthday.json");
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise')).toBe(true);
    expect(text).toContain("<work><work-title>Happy Birthday to You</work-title></work>");
    expect(text).toContain("<key><fifths>-1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves>");
    expect(text).toContain('<measure number="0" implicit="yes">');
    expect(text).toContain('<sound tempo="100"/>');
    expect(text).toContain("<syllabic>begin</syllabic><text>Hap</text>");
    expect(text).toContain("<bar-style>light-heavy</bar-style>");
  });

  it("balances every element it opens", () => {
    for (const name of examples) {
      const stack: string[] = [];
      for (const piece of xml(name).split("<").slice(1)) {
        const element = piece.slice(0, piece.indexOf(">"));
        if (element.startsWith("?") || element.startsWith("!") || element.endsWith("/")) continue;
        const closing = element.startsWith("/");
        const tag = element.slice(closing ? 1 : 0).split(" ")[0];
        if (closing) expect(stack.pop(), `${name}: </${tag}>`).toBe(tag);
        else stack.push(tag ?? "");
      }
      expect(stack, name).toEqual([]);
    }
  });

  it("escapes text", () => {
    const notation = notationOf({ title: "Tom & Jerry <3" }, [melody([{ at: 0, pitch: "C4", lyric: "a<b" }])]);
    const text = notationToMusicXml(notation);
    expect(text).toContain("<work-title>Tom &amp; Jerry &lt;3</work-title>");
    expect(text).toContain("<text>a&lt;b</text>");
  });

  it("gives the same file for the same score (golden)", () => {
    for (const name of examples) expect(xml(name)).toMatchSnapshot(name);
  });
});

describe("the teaching examples", () => {
  it.each(examples)("%s writes clean sheet music: no rounding, no shortened notes", (name) => {
    const check = checkScore(example(name), { notation: true });
    expect(check.ok).toBe(true);
    expect(check.warnings).toEqual([]);
  });
});

describe("sheet music through the tool and the player", () => {
  const birthday = parseScore(example("learn-happy-birthday.json"));

  it("checkScore with view notation reports what the sheet music changes; without it, a jingle gets no such warnings", async () => {
    const offGrid = base({}, [melody([{ at: { seconds: 0.04 }, pitch: "C4" }])]);
    expect(checkScore(offGrid).warnings).toEqual([]);
    const result = await manage({ action: "checkScore", score: offGrid, view: "notation" });
    expect(JSON.parse(result.text).warnings[0].message).toContain("off the sheet-music grid");
  });

  it("puts MusicXML and the presentation into the player's data", async () => {
    const result = await manage(
      { action: "renderScore", score: example("learn-twinkle.json"), view: "notation", autoplay: true, notifyWhenDone: true },
      { player: true },
    );
    expect(result.player?.musicxml).toBe(scoreToMusicXml(parseScore(example("learn-twinkle.json"))));
    expect(result.player?.presentation).toMatchObject({ view: "notation", autoplay: true, notifyWhenDone: true });
    expect(typeof result.player?.presentation?.renderedAt).toBe("number");
    expect(result.player?.presentation).not.toHaveProperty("autoplayDelay");
  });

  it("passes autoplayDelay to the player, and refuses one out of range", async () => {
    const score = example("learn-twinkle.json");
    const delayed = await manage({ action: "renderScore", score, view: "notation", autoplay: true, autoplayDelay: 2.5 }, { player: true });
    expect(delayed.player?.presentation).toMatchObject({ autoplay: true, autoplayDelay: 2.5 });
    expect(ManageInputSchema.safeParse({ action: "renderScore", score, autoplayDelay: -1 }).success).toBe(false);
    expect(ManageInputSchema.safeParse({ action: "renderScore", score, autoplayDelay: 31 }).success).toBe(false);
  });

  it("adds sheet music for a score that sets a meter, and shows the waveform when there is nothing to draw", () => {
    const result = render(birthday, { samples: fixtureSamples });
    expect(toPlayerData(birthday, result, "b").musicxml).toBeDefined();
    const effects = parseScore(base({}, [{ instrument: "clap", notes: [{ at: 0 }] }]));
    const data = toPlayerData(effects, render(effects), "e", undefined, { view: "notation", autoplay: false, notifyWhenDone: false, renderedAt: 0 });
    expect(data.musicxml).toBeUndefined();
    expect(data.presentation?.view).toBe("waveform");
    const jingle = parseScore(base({}, [melody([{ at: 0, pitch: "C4" }])]));
    expect(toPlayerData(jingle, render(jingle, { samples: fixtureSamples }), "j").musicxml).toBeUndefined();
  });
});

describe("snap", () => {
  it("rounds to the nearest 32nd or triplet step, a 32nd on a tie", () => {
    expect([0, 1, 2, 3, 5, 7, 8, 10, 15, 16].map(snap)).toEqual([0, 0, 3, 3, 6, 6, 8, 9, 15, 16]);
  });
});
