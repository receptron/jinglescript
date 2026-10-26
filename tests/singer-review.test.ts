import { createHash } from "node:crypto";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng.ts";
import { parseScore } from "../src/score.ts";
import { render } from "../src/render.ts";
import { biquadFilter } from "../src/dsp/biquad.ts";
import {
  findResonance,
  notesToFrames,
  singerFeatures,
  SingerPhonemeError,
  loadOnnxRuntime,
  moraPhonemes,
  peaking,
  SingerManifestSchema,
  SingerModelCorruptError,
  SingerModelMissingError,
  verifiedModelFile,
} from "../src/singer/index.ts";

const SR = 44100;

// Track 0 (the one under test) panned as given; track 1 a hard-right reference at unit gain.
function twoTracks(track: Record<string, unknown>, note: Record<string, unknown> = {}) {
  const notes = (extra: Record<string, unknown>) => [{ at: 0, pitch: "A4", len: 1, ...extra }];
  return parseScore({
    format: "jinglescript/1",
    tempo: 120,
    length: { beats: 2 },
    master: { reverb: "none", limiter: false },
    tracks: [
      { instrument: "organ", pan: 0, ...track, notes: notes(note) },
      { instrument: "organ", pan: 1, notes: notes({}) },
    ],
  });
}

const sumAbs = (x: Float32Array) => x.reduce((s, v) => s + Math.abs(v), 0);

describe("prerendered tracks follow the track's pan, gain and dynamics", () => {
  const pcm = Float32Array.from({ length: SR }, (_, i) => 0.1 * Math.sin(i / 10));
  /** Level of track 0 relative to the reference. */
  const level = (track: Record<string, unknown>, note?: Record<string, unknown>) => {
    const [left, right] = render(twoTracks(track, note), {
      prerendered: new Map([
        [0, pcm],
        [1, pcm],
      ]),
    }).audio;
    return sumAbs(left) / sumAbs(right);
  };

  it("pans like an instrument", () => {
    expect(level({})).toBeCloseTo(1, 3);
    expect(level({ pan: 1 })).toBeLessThan(1e-6);
  });

  it("applies the track gain and the note velocity", () => {
    expect(level({ gain: -6 })).toBeCloseTo(0.501, 2);
    expect(level({}, { vel: 0.4 })).toBeCloseTo(0.5, 2);
  });
});

describe("loadOnnxRuntime", () => {
  it("uses each given loader rather than caching the first", async () => {
    const make = (tag: string) => async () => ({
      tag,
      InferenceSession: { create: async () => ({}) },
      Tensor: class {
        readonly kind = "tensor";
      },
    });
    const a = await loadOnnxRuntime(make("a"));
    const b = await loadOnnxRuntime(make("b"));
    expect(Reflect.get(a, "tag")).toBe("a");
    expect(Reflect.get(b, "tag")).toBe("b");
  });
});

describe("singer manifest", () => {
  const base = {
    name: "m",
    version: "0",
    license: "CC0-1.0",
    sampleRate: SR,
    hopSize: 256,
    melBins: 8,
    phonemes: ["a"],
    files: { acoustic: "acoustic.onnx" },
    sha256: { "acoustic.onnx": "0".repeat(64) },
  };
  const env = (fftSize: number) => ({ ...base, envelope: { kind: "band-log-power", fftSize, maxHz: 11025 } });

  it("needs fftSize a power of two and >= hopSize", () => {
    expect(SingerManifestSchema.safeParse(env(1024)).success).toBe(true);
    expect(SingerManifestSchema.safeParse(env(1000)).error?.issues[0]?.message).toMatch(/power of two/);
    expect(SingerManifestSchema.safeParse(env(128)).error?.issues[0]?.message).toMatch(/at least hopSize/);
  });

  it("needs a sha256 for every file", () => {
    expect(SingerManifestSchema.safeParse({ ...base, sha256: {} }).success).toBe(false);
  });

  it("checks the ONNX file's sha256 before it is used", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "singer-sha-"));
    await mkdir(join(cacheDir, "singer", "m"), { recursive: true });
    const bytes = Buffer.from("model");
    await writeFile(join(cacheDir, "singer", "m", "acoustic.onnx"), bytes);
    const good = SingerManifestSchema.parse({ ...base, sha256: { "acoustic.onnx": createHash("sha256").update(bytes).digest("hex") } });
    expect(await verifiedModelFile(good, "acoustic.onnx", cacheDir)).toBe(join(cacheDir, "singer", "m", "acoustic.onnx"));
    const bad = SingerManifestSchema.parse(base);
    await expect(verifiedModelFile(bad, "acoustic.onnx", cacheDir)).rejects.toThrow(SingerModelCorruptError);
    await expect(verifiedModelFile(bad, "acoustic.onnx", cacheDir)).rejects.toThrow(/expects 0000/);
    await expect(verifiedModelFile({ ...bad, name: "none" }, "acoustic.onnx", cacheDir)).rejects.toThrow(SingerModelMissingError);
  });
});

describe("findResonance and harmonics", () => {
  it("does not take a held vowel's harmonic for a resonance when given F0", () => {
    const f0 = 220;
    // A held vowel: harmonics 1..30, the 11th (2420 Hz) standing out, plus a little noise.
    const rng = createRng(2);
    const x = Float32Array.from({ length: SR * 2 }, (_, i) => {
      let s = 0;
      for (let h = 1; h <= 30; h++) s += ((h === 11 ? 1 : 0.1) / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR);
      return s + rng.normal() * 0.001;
    });
    expect(findResonance(x, SR)).toBeDefined();
    const found = findResonance(x, SR, f0);
    if (found !== undefined) expect(Math.abs(found.hz / f0 - Math.round(found.hz / f0)) * f0).toBeGreaterThan(8);
  });

  it("still finds a real resonance between harmonics", () => {
    const rng = createRng(1);
    const noise = Float32Array.from({ length: SR * 2 }, () => rng.normal() * 0.1);
    const ringing = Float32Array.from(biquadFilter(noise, peaking(2530, 18, 12, SR)));
    const found = findResonance(ringing, SR, 200);
    expect(found?.hz).toBeGreaterThan(2450);
    expect(found?.hz).toBeLessThan(2600);
  });
});

describe("re-review", () => {
  it("finds a resonance far above 12×F0", () => {
    const rng = createRng(3);
    const noise = Float32Array.from({ length: SR * 2 }, () => rng.normal() * 0.1);
    for (const [hz, f0] of [
      [5150, 330],
      [4630, 200],
    ] as const) {
      const ringing = Float32Array.from(biquadFilter(noise, peaking(hz, 18, 12, SR)));
      const found = findResonance(ringing, SR, f0);
      expect(found?.hz).toBeGreaterThan(hz - 80);
      expect(found?.hz).toBeLessThan(hz + 80);
    }
  });

  const notes = [{ start: 0, end: 0.5, midi: 69, lyric: "でゅ" }];
  const frames = notesToFrames(notes, { hop: 256 / SR });

  it("falls back dy → d for a model without dy", () => {
    const withD = singerFeatures(frames, ["pau", "d", "u"], "m");
    const width = 6;
    expect([...withD].some((v, i) => i % width === 1 && v === 1)).toBe(true);
  });

  it("names the phoneme, note and model when nothing fits", () => {
    expect(() => singerFeatures(frames, ["pau", "u"], "tiny")).toThrow(SingerPhonemeError);
    expect(() => singerFeatures(frames, ["pau", "u"], "tiny")).toThrow(/Note 0: the phoneme "dy" is not in the singer model "tiny"/);
  });

  it("hashes a model file once per path, size and mtime", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "singer-cache-"));
    const path = join(cacheDir, "singer", "c", "acoustic.onnx");
    await mkdir(join(cacheDir, "singer", "c"), { recursive: true });
    await writeFile(path, "aaaa");
    const manifest = SingerManifestSchema.parse({
      name: "c",
      version: "0",
      license: "CC0-1.0",
      sampleRate: SR,
      hopSize: 256,
      melBins: 8,
      phonemes: ["a"],
      files: { acoustic: "acoustic.onnx" },
      sha256: { "acoustic.onnx": createHash("sha256").update("aaaa").digest("hex") },
    });
    await verifiedModelFile(manifest, "acoustic.onnx", cacheDir);
    const when = new Date(2020, 0, 1);
    // Same size, mtime restored: the cached verdict stands even though the bytes changed.
    await utimes(path, when, when);
    await verifiedModelFile(manifest, "acoustic.onnx", cacheDir);
    await writeFile(path, "bbbb");
    await utimes(path, when, when);
    expect(await verifiedModelFile(manifest, "acoustic.onnx", cacheDir)).toBe(path);
    // A changed mtime is hashed again and caught.
    await utimes(path, new Date(2021, 0, 1), new Date(2021, 0, 1));
    await expect(verifiedModelFile(manifest, "acoustic.onnx", cacheDir)).rejects.toThrow(SingerModelCorruptError);
  });
});

describe("loanword kana", () => {
  it("maps とぅ どぅ つぁ すぃ でゅ", () => {
    expect(moraPhonemes("とぅ")).toEqual(["t", "u"]);
    expect(moraPhonemes("トゥ")).toEqual(["t", "u"]);
    expect(moraPhonemes("どぅ")).toEqual(["d", "u"]);
    expect(moraPhonemes("つぁ")).toEqual(["ts", "a"]);
    expect(moraPhonemes("すぃ")).toEqual(["s", "i"]);
    expect(moraPhonemes("でゅ")).toEqual(["dy", "u"]);
    expect(moraPhonemes("てぃ")).toEqual(["t", "i"]);
  });
});
