import { describe, expect, it } from "vitest";
import { integratedLoudness, kWeighting, truePeak } from "../src/dsp/loudness.ts";
import { limit } from "../src/dsp/limiter.ts";
import { marimba } from "../src/instruments/marimba.ts";
import { midiToFrequency } from "../src/pitch.ts";
import { createRng, streamSeed } from "../src/rng.ts";

const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sine = (frequency: number, amplitude: number, seconds: number, sampleRate: number, phase = 0) =>
  Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase));

describe("seeded randomness", () => {
  it("gives different streams for different seeds and keys, the same for the same", () => {
    expect(streamSeed(1)).not.toBe(streamSeed(2));
    expect(streamSeed(1, "note", 0, 1)).not.toBe(streamSeed(1, "note", 0, 2));
    expect(streamSeed(7, "reverb")).toBe(streamSeed(7, "reverb"));
    const a = createRng(5);
    const b = createRng(5);
    expect([a.next(), a.normal()]).toEqual([b.next(), b.normal()]);
  });
});

describe("BS.1770 loudness", () => {
  it("derives the tabulated K-weighting coefficients at 48 kHz", () => {
    const { shelf, highpass } = kWeighting(48000);
    const close = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? NaN, 6));
    close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(shelf.a, [1, -1.69065929318241, 0.73248077421585]);
    close(highpass.a, [1, -1.99004745483398, 0.99007225036621]);
  });

  it("measures a 0 dBFS 997 Hz sine in one channel as -3.01 LUFS, at 48 and 44.1 kHz", () => {
    for (const rate of [48000, 44100]) {
      const left = sine(997, 1, 5, rate);
      expect(integratedLoudness([left, new Float32Array(left.length)], rate)).toBeCloseTo(-3.01, 1);
    }
  });

  it("finds the inter-sample peak a sample peak misses", () => {
    // fs/4 sampled 45° off its peaks: every sample is at 0.354, the waveform reaches 0.5.
    const x = sine(12000, 0.5, 0.1, 48000, Math.PI / 4);
    expect(20 * Math.log10(peakOf(x))).toBeCloseTo(-9.03, 1);
    expect(truePeak([x])).toBeCloseTo(-6.02, 0);
  });

  it("is silent for silence", () => {
    expect(integratedLoudness([new Float32Array(48000), new Float32Array(48000)], 48000)).toBe(-Infinity);
  });
});

describe("limiter", () => {
  it("keeps every sample under the ceiling and leaves quiet audio alone", () => {
    const loud = sine(440, 1, 0.5, 48000);
    const pair: [Float32Array, Float32Array] = [loud, Float32Array.from(loud)];
    expect(limit(pair, 0.5, 48000)).toBeCloseTo(6.02, 1);
    expect(peakOf(pair[0])).toBeLessThanOrEqual(0.5 + 1e-6);
    const quiet = sine(440, 0.1, 0.5, 48000);
    const before = Float32Array.from(quiet);
    expect(limit([quiet, Float32Array.from(quiet)], 0.5, 48000)).toBe(0);
    expect(quiet).toEqual(before);
  });
});

describe("marimba (quality checks without ears)", () => {
  const rate = 48000;
  const note = (midi: number, sampleRate = rate) =>
    marimba.synthesize({ midi, frequency: midiToFrequency(midi), velocity: 1, hold: 0, variant: undefined, sampleRate, rng: createRng(midi) });

  it("renders cleanly across its range C2–C7: finite, starts and ends at zero, no DC", () => {
    for (let midi = 36; midi <= 96; midi++) {
      const x = note(midi);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(Math.abs(x[0] ?? 1)).toBe(0);
      expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(1e-6);
      const peak = peakOf(x);
      const dc = x.reduce((s, v) => s + v, 0) / x.length;
      expect(Math.abs(dc) / peak).toBeLessThan(0.005);
      // The 1.5 ms onset ramp: no step at the start.
      expect(Math.abs(x[1] ?? 1)).toBeLessThan(0.01 * peak);
    }
  });

  it("decays like the prototype's bar: fundamental time constant 0.42 s at C5, 0.63 s at C3", () => {
    // Magnitude of the fundamental in 50 ms windows at 0.3 s and 1.0 s, after the upper modes
    // (time constants ≤ 0.14 s) have died away.
    const tau = (x: Float32Array, frequency: number) => {
      const w = Math.round(0.05 * rate);
      const magnitude = (start: number) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < w; i++) {
          re += (x[start + i] ?? 0) * Math.cos((2 * Math.PI * frequency * i) / rate);
          im += (x[start + i] ?? 0) * Math.sin((2 * Math.PI * frequency * i) / rate);
        }
        return Math.hypot(re, im);
      };
      const t0 = 0.3;
      const t1 = 1.0;
      return (t1 - t0) / Math.log(magnitude(Math.round(t0 * rate)) / magnitude(Math.round(t1 * rate)));
    };
    expect(tau(note(72), midiToFrequency(72))).toBeCloseTo(0.42, 2);
    expect(tau(note(48), midiToFrequency(48))).toBeCloseTo(0.63, 2);
  });

  it("is the same note at 44.1 kHz, just resampled in time", () => {
    expect(note(72, 44100).length / 44100).toBeCloseTo(note(72).length / rate, 3);
  });
});
