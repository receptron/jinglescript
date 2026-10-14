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
    expect(score.copyright).toMatch(/^© 2026 Satoshi Nakajima — CC BY(-SA)? 4\.0/);
    // CC BY-SA needs the original's credit wherever the work goes, and this field is written into rendered audio.
    if (score.copyright?.includes("CC BY-SA")) {
      expect(score.copyright).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
      expect(score.copyright).toMatch(/Adapted from the Mutopia Project edition Mutopia-\d{4}\/\d{2}\/\d{2}-\d+, typeset by .+, CC BY-SA \d\.\d/);
    }
    expect(score.tracks.every((track) => track.instrument === "grandpiano")).toBe(true);
  });
});
