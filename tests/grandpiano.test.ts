import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resample } from "../src/dsp/resample.ts";
import { integratedLoudness } from "../src/dsp/loudness.ts";
import { grandPianoSample, layerFor, nearestSampled } from "../src/instruments/grandpiano.ts";
import { INSTRUMENTS } from "../src/instruments/index.ts";
import { parseScore, render, samplesNeeded, SamplesNotLoadedError, toWav } from "../src/index.ts";
import { midiToFrequency } from "../src/pitch.ts";
import { createRng } from "../src/rng.ts";
import { defaultCacheDir, loadRemoteSamples, loadSamples, SampleDownloadError, type RemoteSample } from "../src/samples/load.ts";
import { decodeWavMono } from "../src/samples/wav-read.ts";
import { PIANO_SET } from "../src/samples/vcsl.ts";
import { pianoFixture } from "./sample-fixture.ts";

const RATE = 48000;
const scoreWith = (notes: unknown[], instruments?: unknown) =>
  parseScore({
    format: "jinglescript/1",
    tempo: 120,
    length: { seconds: 3 },
    ...(instruments === undefined ? {} : { instruments }),
    tracks: [{ instrument: instruments === undefined ? "grandpiano" : "soft", notes }],
  });
const key = (pitch: string, layer: number) => `${PIANO_SET}/JHPiano_NoSus_Close_${pitch}_vl${layer}_rr1.wav`;
const sine = (f: number, rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate));

/** Strongest frequency in x within ±`span` of `near` (Hann-windowed DFT on a 0.1-cent grid). */
function dominant(x: Float32Array, rate: number, near: number, span = 0.03): number {
  let best = 0;
  let bestF = near;
  for (let f = near * (1 - span); f <= near * (1 + span); f += near / 20000) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))) * (x[i] ?? 0);
      re += w * Math.cos((2 * Math.PI * f * i) / rate);
      im += w * Math.sin((2 * Math.PI * f * i) / rate);
    }
    if (Math.hypot(re, im) > best) [best, bestF] = [Math.hypot(re, im), f];
  }
  return bestF;
}

describe("grandpiano picks its samples", () => {
  it("plays the nearest sampled pitch (whole tones from A#0), the lower on a tie", () => {
    expect(nearestSampled(21)).toBe(22); // A0 ← A#0
    expect(nearestSampled(60)).toBe(60); // C4
    expect(nearestSampled(61)).toBe(60); // C#4 ← C4, not D4
    expect(nearestSampled(61.2)).toBe(62);
    expect(nearestSampled(105)).toBe(104); // A7 ← G#7
  });

  it("chooses the velocity layer: 2 up to 0.45, 3 up to 0.75, then 4", () => {
    expect([0.1, 0.45, 0.46, 0.75, 0.76, 1].map(layerFor)).toEqual([2, 2, 3, 3, 4, 4]);
    expect(grandPianoSample(60, 3)).toEqual({ key: key("C4", 3), cents: 0 });
    expect(grandPianoSample(104, 4).cents).toBeGreaterThan(10); // the top is stretched sharp
  });

  it("synthesizes nothing to find that a score without sampled instruments needs no samples", () => {
    const organ = vi.spyOn(INSTRUMENTS.organ, "synthesize");
    const score = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 2 },
      tracks: [{ instrument: "organ", notes: [{ at: 0, chord: "C" }] }],
    });
    expect(samplesNeeded(score)).toEqual([]);
    expect(organ).not.toHaveBeenCalled();
    organ.mockRestore();
  });

  it("lists exactly the samples a score needs, through chords and custom instruments", () => {
    expect(
      samplesNeeded(
        scoreWith([
          { at: 0, pitch: "C4", vel: 0.8 },
          { at: 1, chord: "C", vel: 0.3 },
        ]),
      ),
    ).toEqual(
      // G4 lies between F#4 and G#4: the lower is played.
      [key("C4", 4), key("C4", 2), key("E4", 2), key("F#4", 2)].sort((a, b) => a.localeCompare(b)),
    );
    // A layer of a stack, and a tweak a whole tone up (the written C4 sounds D4).
    expect(samplesNeeded(scoreWith([{ at: 0, pitch: "C4", vel: 0.5 }], { soft: { layers: [{ base: "marimba" }, { base: "grandpiano", gain: -6 }] } }))).toEqual(
      [key("C4", 3)],
    );
    expect(samplesNeeded(scoreWith([{ at: 0, pitch: "C4" }], { soft: { base: "grandpiano", transpose: 2 } }))).toEqual([key("D4", 4)]);
    expect(
      samplesNeeded(
        parseScore({ format: "jinglescript/1", tempo: 120, length: { seconds: 1 }, tracks: [{ instrument: "piano", notes: [{ at: 0, pitch: "C4" }] }] }),
      ),
    ).toEqual([]);
  });
});

describe("grandpiano renders from loaded samples only", () => {
  it("says how to load them when they were not", () => {
    expect(() => render(scoreWith([{ at: 0, pitch: "C4" }]))).toThrow(SamplesNotLoadedError);
    expect(() => render(scoreWith([{ at: 0, pitch: "C4" }]))).toThrow(/loadSamples/);
  });

  it("moves its sample by exactly the interval asked for: a semitone up or down, or a detune", () => {
    // Measured against the unshifted sample, so the stand-in's own tuning does not count.
    const play = (midi: number) =>
      INSTRUMENTS.grandpiano.synthesize({
        midi: Math.round(midi),
        frequency: midiToFrequency(midi),
        velocity: 1,
        hold: 1,
        variant: undefined,
        sampleRate: RATE,
        rng: createRng(1),
        samples: pianoFixture,
      });
    const pitchOf = (midi: number) => dominant(play(midi).subarray(Math.round(0.2 * RATE), Math.round(1.2 * RATE)), RATE, midiToFrequency(midi), 0.01);
    for (const [sampled, played] of [
      [60, 61],
      [62, 61.2],
      [70, 69.3],
      [104, 105],
    ] as const) {
      const cents = 1200 * Math.log2(pitchOf(played) / pitchOf(sampled)) - 100 * (played - sampled);
      expect(Math.abs(cents)).toBeLessThan(1);
    }
  });

  it("is bit-identical on every render", () => {
    const score = scoreWith([
      { at: 0, chord: "Am7", vel: 0.7 },
      { at: 1, pitch: "E6" },
    ]);
    const hash = (audio: readonly Float32Array[]) => {
      const h = createHash("sha256");
      for (const channel of audio) h.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
      return h.digest("hex");
    };
    expect(hash(render(score, { samples: pianoFixture }).audio)).toBe(hash(render(score, { samples: pianoFixture }).audio));
  });
});

describe("resample", () => {
  it("moves a sine by the step and changes the rate", () => {
    const x = sine(440, 44100, 1);
    const y = resample(x, (1.0594630943592953 * 44100) / 48000, 0.45, 40000);
    expect(dominant(y.subarray(2000, 38000), 48000, 466.16)).toBeCloseTo(466.16, 0);
  });

  it("removes what would land above the cutoff instead of folding it back", () => {
    // 20 kHz at 44.1 kHz read twice as fast would be 40 kHz: above Nyquist, so it must vanish.
    const y = resample(sine(20000, 44100, 0.5), 2, 0.2, 8000);
    const rms = Math.sqrt(y.subarray(1000, 7000).reduce((s, v) => s + v * v, 0) / 6000);
    expect(rms).toBeLessThan(1e-3);
  });
});

describe("decodeWavMono", () => {
  it("reads 16- and 24-bit stereo as mono, and a file cut short up to where it ends", () => {
    const left = sine(1000, 44100, 0.1);
    const right = new Float32Array(left.length);
    for (const bits of [16, 24] as const) {
      const wav = toWav([left, right], 44100, bits);
      const { sampleRate, data } = decodeWavMono(wav);
      expect(sampleRate).toBe(44100);
      expect(data).toHaveLength(left.length);
      expect(Math.abs((data[11] ?? 0) - (left[11] ?? 0) / 2)).toBeLessThan(bits === 16 ? 1e-4 : 1e-6);
      expect(decodeWavMono(wav.subarray(0, 44 + 100 * 2 * (bits / 8)))).toMatchObject({ data: { length: 100 } });
    }
    expect(() => decodeWavMono(new Uint8Array(64))).toThrow(/RIFF/);
  });
});

describe("loadRemoteSamples", () => {
  const dirs: string[] = [];
  const cacheDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "jinglescript-samples-"));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const wav = toWav([sine(440, 44100, 0.2), sine(440, 44100, 0.2)], 44100, 24);
  const full = new Uint8Array([...wav, ...new Uint8Array(1000)]); // the server's whole file
  const remote: RemoteSample = {
    pitch: "A4",
    layer: 3,
    file: "test.wav",
    bytes: wav.length,
    sha256: createHash("sha256").update(wav).digest("hex"),
    cents: 0,
    key: "test-set/test.wav",
    path: join("test-set", "test.wav"),
    url: "https://example.invalid/test.wav",
  };
  const serving = (body: Uint8Array, status = 206) => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = (_url, init) => {
      calls.push(new Headers(init?.headers).get("Range") ?? "");
      return Promise.resolve(new Response(body, { status }));
    };
    return { calls, fetch };
  };

  it("downloads the first bytes, caches them, and then reads the cache", async () => {
    const dir = cacheDir();
    const server = serving(full, 200); // a server that ignores Range
    const source = await loadRemoteSamples([remote], { cacheDir: dir, fetch: server.fetch });
    expect(server.calls).toEqual([`bytes=0-${wav.length - 1}`]);
    expect(source.get(remote.key)?.data).toHaveLength(Math.round(0.2 * 44100));
    expect(readFileSync(join(dir, remote.path))).toHaveLength(wav.length);
    const offline = await loadRemoteSamples([remote], { cacheDir: dir, download: false });
    expect(offline.get(remote.key)?.data).toEqual(source.get(remote.key)?.data);
  });

  it("lets two loads fetch the same sample at once", async () => {
    const dir = cacheDir();
    const [a, b] = await Promise.all([0, 1].map(() => loadRemoteSamples([remote], { cacheDir: dir, fetch: serving(wav).fetch })));
    expect(a?.get(remote.key)?.data).toEqual(b?.get(remote.key)?.data);
    expect(readFileSync(join(dir, remote.path))).toHaveLength(wav.length);
  });

  it("refuses bytes that do not match the checksum, and caches nothing", async () => {
    const dir = cacheDir();
    const bad = Uint8Array.from(wav, (b, i) => (i === 100 ? b ^ 1 : b));
    await expect(loadRemoteSamples([remote], { cacheDir: dir, fetch: serving(bad).fetch })).rejects.toThrow(SampleDownloadError);
    expect(existsSync(join(dir, remote.path))).toBe(false);
  });

  it("reports HTTP errors and, with download off, a missing sample", async () => {
    await expect(loadRemoteSamples([remote], { cacheDir: cacheDir(), fetch: serving(new Uint8Array(), 404).fetch })).rejects.toThrow(/HTTP 404/);
    await expect(loadRemoteSamples([remote], { cacheDir: cacheDir(), download: false })).rejects.toThrow(/not in the sample cache/);
  });

  it("loads nothing for a score without sampled instruments", async () => {
    const score = parseScore({
      format: "jinglescript/1",
      tempo: 120,
      length: { seconds: 1 },
      tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
    });
    const fetch: typeof globalThis.fetch = () => Promise.reject(new Error("no network in tests"));
    await expect(loadSamples(score, { cacheDir: cacheDir(), fetch })).resolves.toBeDefined();
  });
});

// The recordings themselves are never downloaded by the tests. When a render has put them in the
// cache, these check the level and the range on the real thing.
const cachedSamples = await loadSamples(
  scoreWith([{ at: 0, pitch: "C5" }, ...["A0", "C2", "F#3", "C4", "A5", "D7", "A7"].map((pitch) => ({ at: 0.1, pitch, vel: 0.9 }))]),
  { cacheDir: defaultCacheDir(), download: false },
).catch(() => undefined);

describe.runIf(cachedSamples !== undefined)("grandpiano on its recordings (only when they are in the cache)", () => {
  const play = (midi: number, velocity = 1) =>
    INSTRUMENTS.grandpiano.synthesize({
      midi,
      frequency: midiToFrequency(midi),
      velocity,
      hold: 1,
      variant: undefined,
      sampleRate: RATE,
      rng: createRng(1),
      samples: cachedSamples,
    });
  const marimba = INSTRUMENTS.marimba.synthesize({
    midi: 72,
    frequency: midiToFrequency(72),
    velocity: 1,
    hold: 1,
    variant: undefined,
    sampleRate: RATE,
    rng: createRng(1),
  });

  it("is as loud as the marimba for a C5 at full velocity (±0.5 LU)", () => {
    const x = play(72);
    expect(Math.abs(integratedLoudness([x, x], RATE) - integratedLoudness([marimba, marimba], RATE))).toBeLessThan(0.5);
  });

  it("stays within 4 LU of its C5 across the range, in tune, finite, ending in silence", () => {
    const c5 = play(72);
    const reference = integratedLoudness([c5, c5], RATE);
    for (const midi of [21, 36, 54, 60, 81, 98, 105]) {
      const x = play(midi, 0.9);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(Math.abs(x[x.length - 1] ?? 1)).toBe(0);
      expect(Math.abs(integratedLoudness([x, x], RATE) - reference)).toBeLessThan(4);
      // Measured as the catalog measures (0.2–2.2 s, where the beating strings average out); in the
      // bass the fundamental is too weak to measure on its own, so pitch is checked from F#3 up.
      if (midi >= 54) {
        const f = midiToFrequency(midi);
        expect(Math.abs(1200 * Math.log2(dominant(x.subarray(Math.round(0.2 * RATE), Math.round(2.2 * RATE)), RATE, f, 0.01) / f))).toBeLessThan(3);
      }
    }
  });
});
