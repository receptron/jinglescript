import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadOnnxRuntime,
  moraPhonemes,
  notesToFrames,
  readSingerManifest,
  SingerLyricError,
  SingerModelMissingError,
  SingerRuntimeMissingError,
  toHiragana,
} from "../src/singer/index.ts";

describe("singer kana", () => {
  it("maps morae to phonemes", () => {
    expect(moraPhonemes("か")).toEqual(["k", "a"]);
    expect(moraPhonemes("カ")).toEqual(["k", "a"]);
    expect(moraPhonemes("し")).toEqual(["sh", "i"]);
    expect(moraPhonemes("きゃ")).toEqual(["ky", "a"]);
    expect(moraPhonemes("ん")).toEqual(["N"]);
    expect(moraPhonemes("あ")).toEqual(["a"]);
    expect(moraPhonemes("ふぁ")).toEqual(["f", "a"]);
    expect(moraPhonemes("abc")).toBeUndefined();
    expect(moraPhonemes("かき")).toBeUndefined();
    expect(toHiragana("マルモ")).toBe("まるも");
  });
});

describe("singer frames", () => {
  const hop = 0.01;
  const notes = [
    { start: 0, end: 0.5, midi: 69, lyric: "か" },
    { start: 0.5, end: 1, midi: 71, lyric: "ー" },
    { start: 1.2, end: 1.5, midi: 72, lyric: "ら" },
  ];

  it("lays out consonant, vowel, hold and rests", () => {
    const frames = notesToFrames(notes, { hop });
    expect(frames.phonemes.map((p) => [p.phoneme, p.start, p.end])).toEqual([
      ["k", 0, 6],
      ["a", 6, 50],
      ["a", 50, 100],
      ["pau", 100, 120],
      ["r", 120, 126],
      ["a", 126, 150],
    ]);
    expect(frames.f0).toHaveLength(150);
  });

  it("gives unvoiced frames 0 Hz and settles on each note's pitch", () => {
    const { f0 } = notesToFrames(notes, { hop });
    expect(f0[0]).toBe(0);
    expect(f0[40]).toBeCloseTo(440, 3);
    expect(f0[110]).toBe(0);
    expect(f0[99]).toBeCloseTo(493.883, 2);
    expect(f0[50]).toBeCloseTo(440, 3); // the glide starts from the previous pitch
  });

  it("is deterministic", () => {
    expect(notesToFrames(notes, { hop }).f0).toEqual(notesToFrames(notes, { hop }).f0);
  });

  it("rejects a lyric that is not one mora", () => {
    expect(() => notesToFrames([{ start: 0, end: 1, midi: 60, lyric: "hello" }])).toThrow(SingerLyricError);
  });
});

describe("singer models", () => {
  it("says how to install a missing model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "singer-"));
    await expect(readSingerManifest("none", dir)).rejects.toThrow(SingerModelMissingError);
  });

  it("reads a valid manifest and rejects a non-free licence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "singer-"));
    const folder = join(dir, "singer", "test");
    await mkdir(folder, { recursive: true });
    const manifest = {
      name: "test",
      version: "0",
      license: "CC0-1.0",
      sampleRate: 44100,
      hopSize: 256,
      melBins: 128,
      phonemes: ["pau", "a"],
      files: { acoustic: "acoustic.onnx", vocoder: "vocoder.onnx" },
      sha256: { "acoustic.onnx": "0".repeat(64), "vocoder.onnx": "1".repeat(64) },
    };
    await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest));
    expect((await readSingerManifest("test", dir)).license).toBe("CC0-1.0");
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ ...manifest, license: "CC-BY-NC-4.0" }));
    await expect(readSingerManifest("test", dir)).rejects.toThrow(SingerModelMissingError);
  });

  it("reports a missing ONNX Runtime", async () => {
    await expect(loadOnnxRuntime(() => Promise.reject(new Error("not found")))).rejects.toThrow(SingerRuntimeMissingError);
    const fake = { InferenceSession: { create: () => Promise.resolve({}) } };
    await expect(loadOnnxRuntime(() => Promise.resolve(fake))).resolves.toBe(fake);
  });
});
