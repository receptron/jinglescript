import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JingleScriptError, NeutrinoMissingError, parseScore, render, SamplesNotLoadedError, type Score } from "../src/index.ts";
import { renderNow } from "../src/render.ts";
import { fixtureSamples } from "./sample-fixture.ts";

// src/ runs on a worker only where Node strips types itself (22.18+); elsewhere render() works in place.
const onWorker = process.features.typescript !== false;

const example = parseScore(JSON.parse(readFileSync(new URL("../examples/piano-ukulele-claps.json", import.meta.url), "utf8")));
const pcmHash = (audio: readonly Float32Array[]) => {
  const hash = createHash("sha256");
  for (const channel of audio) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest("hex");
};
const piano = (seconds: number): Score =>
  parseScore({
    format: "jinglescript/1",
    tempo: 120,
    length: { seconds },
    tracks: [{ instrument: "grandpiano", notes: Array.from({ length: seconds * 2 }, (_, i) => ({ at: i, chord: "Cmaj7", len: 1 })) }],
  });

const sung = parseScore({
  format: "jinglescript/1",
  tempo: 120,
  length: { seconds: 2 },
  tracks: [{ instrument: "organ", sing: { engine: "neutrino" }, notes: [{ at: 1, pitch: "C4", lyric: "か" }] }],
});

describe("render() on a worker thread", () => {
  it("gives the same audio, timing and stats as rendering in place", async () => {
    const options = { samples: fixtureSamples };
    const [onThread, inPlace] = [await render(example, options), renderNow(example, options)];
    expect(pcmHash(onThread.audio)).toBe(pcmHash(inPlace.audio));
    expect(onThread.timing).toEqual(inPlace.timing);
    expect(onThread.stats).toEqual(inPlace.stats);
  });

  it.skipIf(!onWorker)("keeps the caller's event loop running during a long render", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    const started = performance.now();
    try {
      await render(piano(8), { samples: fixtureSamples });
    } finally {
      clearInterval(timer);
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThan(100); // long enough for a blocked loop to show
    expect(ticks).toBeGreaterThan(elapsed / 5 / 4);
  });

  it("runs several renders at once and answers each with its own result", async () => {
    const scores = [1, 2, 3, 4].map((seed) => ({ ...example, seed }));
    const results = await Promise.all(scores.map((score) => render(score, { samples: fixtureSamples })));
    results.forEach((result, i) => expect(pcmHash(result.audio)).toBe(pcmHash(renderNow(scores[i] ?? example, { samples: fixtureSamples }).audio)));
  });

  it("rejects with the error's own class, as rendering in place throws it", async () => {
    await expect(render(piano(2))).rejects.toThrow(SamplesNotLoadedError);
    const twoSung = { ...sung, tracks: [sung.tracks[0], sung.tracks[0]] } as Score; // parseScore would refuse it
    await expect(render(twoSung)).rejects.toThrow(JingleScriptError);
    const before = process.env.NEUTRINO_DIR;
    process.env.NEUTRINO_DIR = "/nonexistent/NEUTRINO";
    try {
      const rejected = render(sung);
      await expect(rejected).rejects.toThrow(NeutrinoMissingError);
      await expect(rejected).rejects.toMatchObject({ dir: "/nonexistent/NEUTRINO" });
    } finally {
      if (before === undefined) delete process.env.NEUTRINO_DIR;
      else process.env.NEUTRINO_DIR = before;
    }
  });
});
