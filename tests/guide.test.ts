import { describe, expect, it } from "vitest";
import { AUTHORING_GUIDE } from "../src/guide.ts";
import { checkScore } from "../src/index.ts";

/** The guide's examples of a whole score: the JSON blocks that start with "format". */
const scores = [...AUTHORING_GUIDE.matchAll(/```json\n([\s\S]*?)```/g)]
  .map((m) => (m[1] ?? "").trim())
  .filter((snippet) => snippet.startsWith("{") && snippet.includes('"format"'));

describe("the authoring guide's example scores", () => {
  it("are found", () => {
    expect(scores.length).toBeGreaterThanOrEqual(4);
  });

  it.each(scores.map((snippet) => [snippet.slice(0, 80), snippet]))("check without errors or warnings: %s", (_, snippet) => {
    const result = checkScore(JSON.parse(snippet), { notation: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
