import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkScore } from "../src/index.ts";

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("docs/video-sound-effects.md", () => {
  // The cue times the walk-through measured in the film; the guide's arithmetic and its frame
  // check depend on them.
  it("its score checks, with the cues at the measured times", () => {
    const result = checkScore(json("../docs/video/big-buck-bunny.json"));
    expect(result.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(result.cues).map(([name, cue]) => [name, cue.seconds]))).toEqual({
      cut: 5.5,
      bonk1: 6.625,
      bonk2: 7.25,
      bonk3: 7.583,
      bonk4: 7.833,
    });
    expect(result.duration).toBe(9.5);
  });
});
