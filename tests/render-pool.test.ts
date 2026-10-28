import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JingleScriptError, NeutrinoMissingError, parseScore, render, SamplesNotLoadedError, type RenderProgress, type Score } from "../src/index.ts";
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

/**
 * A stand-in NEUTRINO install: musicXMLtoLabel writes empty labels; neutrino prints its progress as
 * the real one does with -t (\r-separated), taking about a second, then writes 6 s of quiet tone.
 */
function fakeNeutrino(): string {
  const dir = mkdtempSync(join(tmpdir(), "neutrino-progress-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "model", "REINA"), { recursive: true });
  writeFileSync(join(dir, "model", "REINA", "info.toml"), "");
  writeFileSync(join(dir, "model", "REINA", "version_information.txt"), "REINA v3.2.2");
  const node = `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\n`;
  writeFileSync(join(dir, "bin", "musicXMLtoLabel"), `${node}fs.writeFileSync(args[1], ""); fs.writeFileSync(args[2], "");\n`);
  writeFileSync(
    join(dir, "bin", "neutrino"),
    `${node}const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (const p of [10, 40, 70]) { process.stdout.write("   progress = " + p + " % (x / y sec)"); wait(400); }
process.stdout.write("   progress = 100 % (y / y sec)finish\\n");
const rate = 48000, n = rate * 6, wav = Buffer.alloc(44 + n * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(i % 100 < 50 ? 1000 : -1000, 44 + i * 2);
fs.writeFileSync(args[4], wav);
`,
  );
  chmodSync(join(dir, "bin", "musicXMLtoLabel"), 0o755);
  chmodSync(join(dir, "bin", "neutrino"), 0o755);
  return dir;
}

/** Runs `body` with these environment variables set (the worker shares the environment), then restores them. */
async function withEnv(vars: Record<string, string>, body: () => Promise<void>): Promise<void> {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

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

  it.runIf(onWorker && process.platform !== "win32")("reports NEUTRINO's progress while it sings, then the mix", async () => {
    await withEnv({ NEUTRINO_DIR: fakeNeutrino(), JINGLESCRIPT_CACHE: mkdtempSync(join(tmpdir(), "jinglescript-cache-")) }, async () => {
      const progress: RenderProgress[] = [];
      await render(sung, { onProgress: (p) => progress.push(p) });
      const singing = progress.flatMap((p) => (p.stage === "singing" ? [p.done] : []));
      expect(singing[0]).toBe(0);
      expect(singing.some((done) => done > 0 && done < 1)).toBe(true); // heard while NEUTRINO ran
      expect(singing).toEqual([...singing].sort((a, b) => a - b));
      expect(progress.at(-1)).toEqual({ stage: "mixing" });
    });
  });
});
