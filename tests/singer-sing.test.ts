import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng.ts";
import { parseScore } from "../src/score.ts";
import { render } from "../src/render.ts";
import { notesToFrames, renderWithSinger, singerFeatures, singerNotes, synthesizeEnvelope } from "../src/singer/index.ts";

const PHONEMES = ["pau", "a", "i", "u", "e", "o", "k", "r", "N"];
const BANDS = 8;
const score = parseScore({
  format: "jinglescript/1",
  tempo: 120,
  length: { beats: 4 },
  tracks: [
    {
      instrument: "organ",
      notes: [
        { at: 0, pitch: "A4", len: 1, lyric: "か" },
        { at: 1, pitch: "C5", len: 1, lyric: "ら" },
      ],
    },
  ],
});

function fakeRuntime(seen: { dims?: readonly number[] }) {
  class Tensor {
    readonly dims: readonly number[];
    constructor(_type: string, _data: Float32Array, dims: readonly number[]) {
      this.dims = dims;
    }
  }
  return async () => ({
    Tensor,
    InferenceSession: {
      create: async () => ({
        run: async (feeds: Record<string, Tensor>) => {
          const dims = feeds.features?.dims ?? [0, 0];
          seen.dims = dims;
          return { envelope: { data: new Float32Array((dims[0] ?? 0) * BANDS).fill(-6) } };
        },
      }),
    },
  });
}

const ONNX_BYTES = Buffer.from("fake onnx");

async function installFake(): Promise<string> {
  const cacheDir = await mkdtemp(join(tmpdir(), "singer-sing-"));
  const folder = join(cacheDir, "singer", "fake");
  await mkdir(folder, { recursive: true });
  const manifest = {
    name: "fake",
    version: "0",
    license: "CC0-1.0",
    sampleRate: 44100,
    hopSize: 256,
    melBins: BANDS,
    phonemes: PHONEMES,
    envelope: { kind: "band-log-power", fftSize: 1024, maxHz: 11025 },
    files: { acoustic: "acoustic.onnx" },
    sha256: { "acoustic.onnx": createHash("sha256").update(ONNX_BYTES).digest("hex") },
  };
  await writeFile(join(folder, "acoustic.onnx"), ONNX_BYTES);
  await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest));
  return cacheDir;
}

describe("singer track", () => {
  it("reads a track's notes and lyrics", () => {
    const notes = singerNotes(score, 0);
    expect(notes.map((n) => [n.midi, n.lyric])).toEqual([
      [69, "か"],
      [72, "ら"],
    ]);
    expect(notes[0]?.start).toBe(0);
    expect(notes[1]?.start).toBeCloseTo(0.5);
  });

  it("builds one-hot, pitch, voicing and position features", () => {
    const frames = notesToFrames(singerNotes(score, 0), { hop: 256 / 44100 });
    const width = PHONEMES.length + 3;
    const features = singerFeatures(frames, PHONEMES);
    expect(features).toHaveLength(frames.f0.length * width);
    const vowel = frames.phonemes.find((span) => span.phoneme === "a");
    if (vowel === undefined) throw new Error("no vowel");
    const row = vowel.start * width;
    expect(features[row + PHONEMES.indexOf("a")]).toBe(1);
    expect(features[row + width - 2]).toBe(1);
    expect(features[row + width - 3]).toBeCloseTo(0, 1);
  });
});

describe("singer vocoder", () => {
  const format = { sampleRate: 44100, hopSize: 256, bands: BANDS, fftSize: 1024, maxHz: 11025 };
  const f0 = new Float32Array(100).fill(220);
  f0.fill(0, 0, 10);
  const env = new Float32Array(100 * BANDS).fill(-6);

  it("is deterministic, finite and pitched at F0", () => {
    const a = synthesizeEnvelope(env, f0, format, createRng(1));
    const b = synthesizeEnvelope(env, f0, format, createRng(1));
    expect(a).toEqual(b);
    expect(a).toHaveLength(100 * 256);
    expect(a.every(Number.isFinite)).toBe(true);
    // Autocorrelation peak of a voiced stretch at the period of 220 Hz.
    const s = a.subarray(30 * 256, 80 * 256);
    let best = 0;
    let lag = 0;
    for (let l = 100; l < 400; l++) {
      let sum = 0;
      for (let i = 0; i + l < s.length; i++) sum += (s[i] ?? 0) * (s[i + l] ?? 0);
      if (sum > best) [best, lag] = [sum, l];
    }
    expect(44100 / lag).toBeCloseTo(220, -1);
  });
});

describe("renderWithSinger", () => {
  it("sings the track in place of its instrument, through render() and the master", async () => {
    const cacheDir = await installFake();
    const seen: { dims?: readonly number[] } = {};
    const sung = await renderWithSinger(score, { track: 0, model: "fake", cacheDir, loadRuntime: fakeRuntime(seen) });
    expect(seen.dims?.[1]).toBe(PHONEMES.length + 3);
    expect(sung.audio[0].every(Number.isFinite)).toBe(true);
    expect(sung.stats.loudness).toBeCloseTo(render(score).stats.loudness, 0);
    expect(sung.audio[0]).not.toEqual(render(score).audio[0]);
    expect({ ...sung.timing, audibleUntil: 0 }).toEqual({ ...render(score).timing, audibleUntil: 0 });
  });

  it("runs the optional vocal chain when asked", async () => {
    const cacheDir = await installFake();
    const { singTrack } = await import("../src/singer/index.ts");
    const plain = await singTrack(score, { track: 0, model: "fake", cacheDir, loadRuntime: fakeRuntime({}) });
    const post = await singTrack(score, { track: 0, model: "fake", cacheDir, loadRuntime: fakeRuntime({}), post: true });
    expect(plain.post).toBeUndefined();
    expect(post.post?.ride).toBeDefined();
    expect(post.pcm.every(Number.isFinite)).toBe(true);
    expect(post.pcm).not.toEqual(plain.pcm);
  });

  it("render() skips a prerendered track's instrument", () => {
    const silent = render(score, { prerendered: new Map([[0, new Float32Array(0)]]) });
    expect(silent.audio[0].every((s) => s === 0)).toBe(true);
  });
});
