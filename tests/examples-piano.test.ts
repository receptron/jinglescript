import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScore } from "../src/index.ts";

// The full-length piano pieces are too long to render in the test suite (examples/piano/README.md);
// this only checks that each one is a valid score that carries its author and licence.
describe("examples/piano", () => {
  const dir = new URL("../examples/piano/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has the pieces", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s parses and names its author and licence", (file) => {
    const score = parseScore(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    expect(score.author).toBe("Satoshi Nakajima");
    expect(score.copyright).toMatch(/CC BY(-SA)? 4\.0$/);
    expect(score.tracks.every((track) => track.instrument === "grandpiano")).toBe(true);
  });
});
