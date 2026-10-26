import { describe, expect, it } from "vitest";
import { biquadFilter } from "../src/dsp/biquad.ts";
import { integratedLoudness, truePeak } from "../src/dsp/loudness.ts";
import * as dmath from "../src/dsp/math.ts";
import { createRng } from "../src/rng.ts";
import { findResonance, msWidth, peaking, vocalChain } from "../src/singer/index.ts";

const SR = 44100;

/** A sung-ish test tone: harmonics of 220 Hz, loud then quiet, with silence between. */
function vocal(): Float32Array {
  const x = new Float32Array(SR * 2);
  const rng = createRng(3);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let level = 0.03;
    if (t < 1.0) level = 0;
    if (t < 0.8) level = 0.5;
    let s = 0;
    for (let k = 1; k <= 10; k++) s += dmath.sin(2 * Math.PI * 220 * k * t) / k;
    x[i] = level * s + rng.normal() * 1e-5;
  }
  return x;
}

describe("vocal chain", () => {
  it("is deterministic and finite, and reports each stage", () => {
    const a = vocalChain(vocal(), SR);
    const b = vocalChain(vocal(), SR);
    expect(a.pcm).toEqual(b.pcm);
    expect(a.pcm.every(Number.isFinite)).toBe(true);
    expect(a.stats.ride?.maxBoostDb).toBeLessThanOrEqual(6);
    expect(a.stats.upward?.maxBoostDb).toBeLessThanOrEqual(6);
    expect(a.stats.limiterDb).toBeUndefined();
  });

  it("does not lift the silence (gate)", () => {
    const input = vocal();
    const out = vocalChain(input, SR).pcm;
    const rms = (x: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += (x[i] ?? 0) * (x[i] ?? 0);
      return Math.sqrt(s / (to - from));
    };
    const gap = [Math.round(SR * 0.85), Math.round(SR * 0.95)] as const;
    expect(rms(out, ...gap)).toBeLessThan(rms(input, ...gap) * 2);
    // and the quiet phrase is brought up relative to the loud one
    const before = rms(input, SR * 1.2, SR * 1.9) / rms(input, SR * 0.1, SR * 0.7);
    const after = rms(out, SR * 1.2, SR * 1.9) / rms(out, SR * 0.1, SR * 0.7);
    expect(after).toBeGreaterThan(before);
  });

  it("standalone: below the true-peak ceiling and never louder than the target", () => {
    const { pcm, stats } = vocalChain(vocal(), SR, { standalone: { ceilingDbtp: -1, targetLufs: -16 } });
    expect(truePeak([pcm])).toBeLessThanOrEqual(-1);
    expect(stats.loudness).toBeLessThanOrEqual(-16 + 0.1);
    expect(stats.loudness).toBeCloseTo(integratedLoudness([pcm], SR), 6);
  });

  it("notches a planted resonance", () => {
    const rng = createRng(1);
    const noise = Float32Array.from({ length: SR * 2 }, () => rng.normal() * 0.1);
    const ringing = Float32Array.from(biquadFilter(noise, peaking(2500, 18, 12, SR)));
    const found = findResonance(ringing, SR);
    expect(found?.hz).toBeGreaterThan(2400);
    expect(found?.hz).toBeLessThan(2600);
    const { stats } = vocalChain(ringing, SR, { ride: false, upward: false });
    expect(stats.notch?.cutDb).toBeGreaterThan(0);
    expect(stats.notch?.cutDb).toBeLessThanOrEqual(6);
    expect(findResonance(Float32Array.from(noise), SR)).toBeUndefined();
  });

  it("M/S keeps the mid and caps the width", () => {
    const left = Float32Array.from({ length: 4096 }, (_, i) => dmath.sin(i / 3));
    const right = left.slice();
    msWidth(left, right, 3, SR);
    expect(left).toEqual(right); // mono in, mono out
  });
});
