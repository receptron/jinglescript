import { describe, expect, it } from "vitest";
import { expandScore } from "../src/events.ts";
import { checkScore, parseScore, render } from "../src/index.ts";

const score = (tracks: unknown[], master: Record<string, unknown> = {}) => ({
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 5 },
  master,
  cues: { hit: { seconds: 3 } },
  tracks,
});

describe("effects with a length", () => {
  it("can be placed by `end`: a riser of 4 beats ends exactly on the cue", () => {
    const s = parseScore(score([{ instrument: "riser", notes: [{ end: "hit", len: 4 }] }]));
    const [event] = expandScore(s).events;
    expect(event).toMatchObject({ seconds: 1, end: 3, hold: 2 });
    const { timing } = render(s);
    expect(timing.notes[0]).toMatchObject({ t: 1, end: 3, instrument: "riser" });
  });

  it("use their default length without `len`", () => {
    const [event] = expandScore(parseScore(score([{ instrument: "whoosh", notes: [{ at: 1 }] }]))).events;
    expect(event).toMatchObject({ seconds: 0.5, hold: 0.5, end: 1 });
  });

  it("explains `end` on a sound without a length, and `at` together with `end`", () => {
    expect(checkScore(score([{ instrument: "clap", notes: [{ end: "hit" }] }])).errors[0]?.message).toContain("cannot be placed by `end`");
    expect(checkScore(score([{ instrument: "riser", notes: [{ at: 0, end: "hit" }] }])).errors[0]?.message).toContain("not both");
  });

  it("take an optional starting pitch (laser, pop), in range", () => {
    expect(checkScore(score([{ instrument: "laser", notes: [{ at: 0 }, { at: 1, pitch: "C7" }] }])).ok).toBe(true);
    expect(checkScore(score([{ instrument: "laser", notes: [{ at: 0, pitch: "C2" }] }])).errors[0]?.message).toContain("outside laser's range");
  });

  it("alternate variants over repeats: tick, tock, tick, tock", () => {
    const { events } = expandScore(parseScore(score([{ instrument: "clock", notes: [{ at: 0, variant: ["tick", "tock"], repeat: { every: 1, count: 4 } }] }])));
    expect(events.map((e) => e.variant)).toEqual(["tick", "tock", "tick", "tock"]);
  });
});

describe('tracks with "reverb": false', () => {
  it("bypass the reverb: a dry track sounds the same whatever the reverb", () => {
    const tracks = [{ instrument: "clock", reverb: false, notes: [{ at: 0, repeat: { every: 1, count: 4 } }] }];
    const room = render(parseScore(score(tracks, { reverb: "room" }))).audio[0];
    const none = render(parseScore(score(tracks, { reverb: "none" }))).audio[0];
    expect(room).toEqual(none);
  });
});
