import { describe, expect, it } from "vitest";
import { checkScore, loadSamples, parseScore, render } from "jinglescript";
import { markRows, SOUND_IDS, SOUNDS, STYLE_IDS, studioScore, type Mark, type StudioInput } from "../playground/studio/score.ts";

/** A small seeded generator, so a failing input can be reproduced from the printed seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(random: () => number): StudioInput {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] ?? (items[0] as T);
  const duration = 0.5 + random() * 70;
  const marks: Mark[] = Array.from({ length: Math.floor(random() * 12) }, (_, i) => ({
    id: `m${i}`,
    t: -1 + random() * (duration + 2),
    sound: pick(SOUND_IDS),
  }));
  return { duration, marks, style: pick([...STYLE_IDS, "none"] as const), hitMarkId: random() < 0.6 ? pick(marks)?.id : undefined };
}

const SEED = 20261015;
const CASES = 400;

describe("studioScore", () => {
  it(`gives a score that checks for every input with something to play (seed ${SEED}, ${CASES} inputs)`, () => {
    const random = rng(SEED);
    let checked = 0;
    for (let i = 0; i < CASES; i++) {
      const input = randomInput(random);
      const score = studioScore(input);
      if (score.tracks.length === 0) continue;
      const result = checkScore(score);
      expect({ case: i, input, errors: result.errors }).toEqual({ case: i, input, errors: [] });
      checked++;
    }
    expect(checked).toBeGreaterThan(CASES / 2);
  });

  it("puts each mark's sound on the mark: struck sounds start there, lead-ins end there", async () => {
    const marks: Mark[] = [
      { id: "a", t: 1.25, sound: "ding" },
      { id: "b", t: 2.5, sound: "whoosh" },
      { id: "c", t: 3.1, sound: "impact" },
    ];
    const score = studioScore({ duration: 5, marks, style: "none" });
    expect(score.cues).toEqual({ mark1: { seconds: 1.25 }, mark2: { seconds: 2.5 }, mark3: { seconds: 3.1 } });
    const parsed = parseScore(score);
    const { timing } = render(parsed, { samples: await loadSamples(parsed, { download: false }) });
    const onset = (name: string) => timing.notes.find((n) => score.tracks[n.track]?.name === name)?.t;
    expect(onset("ding")).toBeCloseTo(1.25, 3);
    expect(onset("impact")).toBeCloseTo(3.1, 3);
    expect(onset("whoosh")).toBeCloseTo(2.5 - SOUNDS.whoosh.lead.seconds, 3);
  });

  it("lands the music's chord on the hit mark, and without one plays a jingle from the start", () => {
    const marks: Mark[] = [{ id: "h", t: 3.5, sound: "impact" }];
    const chordAt = (input: StudioInput) => studioScore(input).tracks[0]?.notes.find((n) => Array.isArray(n.pitch))?.at;
    expect(chordAt({ duration: 6, marks, style: "marimba", hitMarkId: "h" })).toEqual({ seconds: 3.5 });
    expect(chordAt({ duration: 6, marks, style: "marimba" })).toEqual({ seconds: 2 });
    expect(studioScore({ duration: 6, marks, style: "none", hitMarkId: "h" }).tracks.map((t) => t.name)).toEqual(["impact"]);
  });

  it("leaves out marks outside the video and shortens a lead-in that would start before 0", () => {
    const score = studioScore({
      duration: 4,
      style: "none",
      marks: [
        { id: "before", t: -0.5, sound: "pop" },
        { id: "after", t: 4.2, sound: "pop" },
        { id: "early", t: 0.3, sound: "riser" },
      ],
    });
    expect(Object.keys(score.cues ?? {})).toEqual(["mark1"]);
    expect(score.tracks).toEqual([{ instrument: "riser", name: "riser", notes: [{ variant: "noise", end: "mark1", len: { seconds: 0.3 } }] }]);
  });

  it("names cues by position, so ids that collide or repeat still get a cue and a sound each", () => {
    const score = studioScore({
      duration: 5,
      style: "none",
      marks: [
        { id: "a-b", t: 1, sound: "pop" },
        { id: "ab", t: 2, sound: "pop" },
        { id: "!!", t: 3, sound: "ding" },
        { id: "!!", t: 4, sound: "ding" },
      ],
    });
    expect(score.cues).toEqual({ mark1: { seconds: 1 }, mark2: { seconds: 2 }, mark3: { seconds: 3 }, mark4: { seconds: 4 } });
    expect(score.tracks.flatMap((t) => t.notes.map((n) => n.at))).toEqual(["mark1", "mark2", "mark3", "mark4"]);
    expect(checkScore(score).errors).toEqual([]);
  });

  it("keeps footsteps inside the video", () => {
    const steps = studioScore({ duration: 2, style: "none", marks: [{ id: "s", t: 1.2, sound: "steps" }] }).tracks[0]?.notes;
    expect(steps?.map((n) => n.at)).toEqual([{ seconds: 1.2 }, { seconds: 1.6 }]);
  });
});

describe("markRows", () => {
  const mark = (id: string, t: number): Mark => ({ id, t, sound: "pop" });
  it("keeps marks far apart on one row and stacks marks close together", () => {
    expect(markRows([mark("a", 1), mark("b", 4), mark("c", 4), mark("d", 4.1), mark("e", 9)], 10, 0.04)).toEqual([0, 0, 1, 2, 0]);
    // In the order given, whatever order the times are in.
    expect(markRows([mark("e", 9), mark("b", 4), mark("a", 1), mark("c", 4)], 10, 0.04)).toEqual([0, 0, 0, 1]);
  });
  it("reuses a row once the gap allows it, and handles no marks and a zero duration", () => {
    expect(markRows([mark("a", 0), mark("b", 0), mark("c", 1)], 10, 0.04)).toEqual([0, 1, 0]);
    expect(markRows([], 10, 0.04)).toEqual([]);
    expect(markRows([mark("a", 0)], 0, 0.04)).toEqual([0]);
  });
  it("gives marks with the same id rows of their own", () => {
    expect(markRows([mark("x", 2), mark("x", 2)], 10, 0.04)).toEqual([0, 1]);
  });
});
