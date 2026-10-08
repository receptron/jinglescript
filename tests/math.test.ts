import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as dmath from "../src/dsp/math.ts";

const range = (n: number, lo: number, hi: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
const worst = (f: (x: number) => number, g: (x: number) => number, xs: number[], relative: boolean) =>
  xs.reduce((w, x) => {
    const a = f(x);
    const b = g(x);
    return Math.max(w, relative ? Math.abs(a - b) / Math.max(Math.abs(b), 1e-300) : Math.abs(a - b));
  }, 0);

describe("deterministic math (src/dsp/math.ts)", () => {
  it("matches Math.* to within a few ulps", () => {
    expect(worst(dmath.sin, Math.sin, range(20001, -1e6, 1e6), false)).toBeLessThan(1e-14);
    expect(worst(dmath.cos, Math.cos, range(20001, -1e5, 1e5), false)).toBeLessThan(1e-14);
    expect(worst(dmath.exp, Math.exp, range(20001, -700, 700), true)).toBeLessThan(1e-15);
    expect(worst(dmath.log, Math.log, range(20001, 1e-300, 1e6), true)).toBeLessThan(1e-15);
    expect(
      worst(
        (x) => dmath.pow(x, 1.1),
        (x) => Math.pow(x, 1.1),
        range(20001, 1e-3, 1e3),
        true,
      ),
    ).toBeLessThan(1e-14);
    expect(
      worst(
        (y) => dmath.atan2(y, 1.7),
        (y) => Math.atan2(y, 1.7),
        range(20001, -1e3, 1e3),
        false,
      ),
    ).toBeLessThan(1e-15);
    expect(dmath.dbToGain(20)).toBeCloseTo(10, 12);
    expect(dmath.gainToDb(0.5)).toBeCloseTo(-6.0206, 4);
  });

  it("handles the edges", () => {
    expect([dmath.exp(0), dmath.log(1), dmath.sin(0), dmath.cos(0), dmath.pow(2, 10)]).toEqual([1, 0, 0, 1, 1024]);
    expect(dmath.log(0)).toBe(-Infinity);
    expect(dmath.exp(-1000)).toBe(0);
    expect(dmath.exp(1000)).toBe(Infinity);
    expect(dmath.pow(-2, 3)).toBeCloseTo(-8, 12);
  });

  it("gives the same bits on every machine (this hash is checked on every CI platform)", () => {
    const values = new Float64Array(
      range(4096, -50, 50).flatMap((x) => [dmath.sin(x * 977), dmath.cos(x), dmath.exp(x), dmath.log(Math.abs(x) + 1e-3), dmath.pow(Math.abs(x) + 0.5, 0.7)]),
    );
    expect(createHash("sha256").update(new Uint8Array(values.buffer)).digest("hex")).toMatchInlineSnapshot(
      `"15a6f9d0e4f084ea1deb34fc36fe7351a28f1a9294dd09072a2c1edc4da14063"`,
    );
  });
});
