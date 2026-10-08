import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fft } from "../src/dsp/fft.ts";
import { integratedLoudness, truePeak } from "../src/dsp/loudness.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS, type InstrumentName } from "../src/instruments/index.ts";
import { MAX_PARTIAL_FRACTION } from "../src/instruments/common.ts";
import { parseScore, render } from "../src/index.ts";
import { midiToFrequency, pitchToMidi } from "../src/pitch.ts";
import { createRng } from "../src/rng.ts";

const RATE = 48000;
const note = (name: InstrumentName, midi: number | undefined, sampleRate = RATE, hold = 1, variant?: string, seed = 7) => {
  const { descriptor } = INSTRUMENTS[name];
  const frequency = midi === undefined ? undefined : midiToFrequency(midi + descriptor.transpose);
  // Effects with a length are tested at their default length.
  const length = descriptor.duration?.defaultSeconds ?? hold;
  return INSTRUMENTS[name].synthesize({ midi, frequency, velocity: 1, hold: length, variant, sampleRate, rng: createRng(seed) });
};
/** Tonal sounds, whose partials must stay clear of Nyquist. Noise is not "aliasing". */
const tonal = (name: InstrumentName): boolean => INSTRUMENTS[name].descriptor.pitched || INSTRUMENTS[name].descriptor.pitchOptional === true;
/** Every variant of an instrument, or just the plain sound when it has none. */
const variantsOf = (name: InstrumentName): (string | undefined)[] => {
  const variants = INSTRUMENTS[name].descriptor.variants;
  return variants.length > 0 ? [...variants] : [undefined];
};
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Pitches across an instrument's range: both ends and every third semitone between. */
function rangeOf(name: InstrumentName): (number | undefined)[] {
  const range = INSTRUMENTS[name].descriptor.range;
  if (range === null) return [undefined];
  const optional = INSTRUMENTS[name].descriptor.pitchOptional === true;
  const low = pitchToMidi(range.low) ?? 60;
  const high = pitchToMidi(range.high) ?? 60;
  const pitches: number[] = [];
  for (let m = low; m < high; m += 3) pitches.push(m);
  return optional ? [undefined, ...pitches, high] : [...pitches, high];
}

/** Share of the energy above sampleRate × MAX_PARTIAL_FRACTION in an 8192-sample window. */
function energyAboveLimit(x: Float32Array, start: number, sampleRate: number): number {
  const n = 8192;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  let above = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    total += power;
    if ((k * sampleRate) / n > sampleRate * MAX_PARTIAL_FRACTION) above += power;
  }
  return total === 0 ? 0 : above / total;
}

/** Strongest frequency within ±60 cents of `f`, in cents from it (windowed DFT on a fine grid). */
function pitchError(x: Float32Array, f: number, from: number, seconds: number): number {
  const a = Math.round(from * RATE);
  const b = Math.min(x.length, a + Math.round(seconds * RATE));
  let best = 0;
  let bestCents = 0;
  for (let cents = -60; cents <= 60; cents += 0.5) {
    const g = f * 2 ** (cents / 1200);
    let re = 0;
    let im = 0;
    for (let i = a; i < b; i++) {
      const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a))) * (x[i] ?? 0);
      re += w * Math.cos((2 * Math.PI * g * i) / RATE);
      im += w * Math.sin((2 * Math.PI * g * i) / RATE);
    }
    const magnitude = Math.hypot(re, im);
    if (magnitude > best) {
      best = magnitude;
      bestCents = cents;
    }
  }
  return bestCents;
}

describe.each(INSTRUMENT_NAMES)("%s (quality checks without ears)", (name) => {
  const { descriptor } = INSTRUMENTS[name];

  it.each(variantsOf(name))(
    "renders cleanly across its stated range (variant %s): finite, onset ramp, ends in silence, no DC, nothing near Nyquist",
    (variant) => {
      for (const midi of rangeOf(name)) {
        const x = note(name, midi, RATE, 1, variant);
        const peak = peakOf(x);
        expect(x.every(Number.isFinite)).toBe(true);
        expect(peak).toBeGreaterThan(0);
        expect(Math.abs(x[0] ?? 1)).toBe(0);
        // Impulses are loudest in their first milliseconds, so their second sample can be a little higher.
        expect(Math.abs(x[1] ?? 1)).toBeLessThan((descriptor.transient === true ? 0.1 : 0.05) * peak);
        expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(1e-4 * peak);
        expect(Math.abs(x.reduce((s, v) => s + v, 0) / x.length) / peak).toBeLessThan(0.005);
        // After the attack noise: the partials stay below the limit.
        if (tonal(name) && x.length > 0.2 * RATE + 8192) expect(energyAboveLimit(x, Math.round(0.2 * RATE), RATE)).toBeLessThan(1e-5);
      }
    },
  );

  it.runIf(descriptor.transient === true).each(variantsOf(name))(
    "peaks like a C5 marimba note at full velocity (variant %s, ±1 dB), so mixes balance",
    (variant) => {
      const peak = (n: InstrumentName, v?: string) => {
        const values = [1, 2, 3, 4, 5].map((seed) => peakOf(note(n, INSTRUMENTS[n].descriptor.pitched ? 72 : undefined, RATE, 1, v, seed)));
        return 20 * Math.log10(values.reduce((a, b) => a + b, 0) / values.length);
      };
      expect(Math.abs(peak(name, variant) - 20 * Math.log10(peakOf(note("marimba", 72))))).toBeLessThan(1);
    },
  );

  it.runIf(descriptor.transient !== true).each(variantsOf(name))(
    "is as loud as the marimba for a C5 at full velocity (variant %s, ±0.5 LU), so mixes balance",
    (variant) => {
      // Noise-based sounds vary a little with the seed: compare the mean over five seeds.
      const loudness = (n: InstrumentName, v?: string) => {
        const values = [1, 2, 3, 4, 5].map((seed) => {
          const x = note(n, INSTRUMENTS[n].descriptor.pitched ? 72 : undefined, RATE, 1, v, seed);
          return integratedLoudness([x, x], RATE);
        });
        return values.reduce((a, b) => a + b, 0) / values.length;
      };
      expect(Math.abs(loudness(name, variant) - loudness("marimba"))).toBeLessThan(0.5);
    },
  );

  it.runIf(descriptor.pitched)("plays in tune (±10 cents; vibrato instruments average out)", () => {
    const pitches = rangeOf(name).filter((m) => m !== undefined);
    const checks = [pitches[Math.floor(pitches.length / 2)], pitches[pitches.length - 1]];
    for (const midi of checks) {
      if (midi === undefined) continue;
      const x = note(name, midi);
      expect(Math.abs(pitchError(x, midiToFrequency(midi + descriptor.transpose), 0.25, 0.5))).toBeLessThanOrEqual(10);
    }
  });

  it.runIf(descriptor.kind === "sfx" && descriptor.duration === undefined)(
    "starts on its onset: a quarter of its peak within 5 ms (no silent pre-roll)",
    () => {
      for (const variant of variantsOf(name)) {
        const x = note(name, undefined, RATE, 1, variant);
        const peak = peakOf(x);
        expect(x.findIndex((v) => Math.abs(v) >= 0.25 * peak)).toBeLessThan(0.005 * RATE);
      }
    },
  );

  it("renders at 44.1 kHz too", () => {
    const x = note(name, descriptor.pitched ? 72 : undefined, 44100);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peakOf(x)).toBeGreaterThan(0);
  });
});

describe("sustained instruments hold for the note's length", () => {
  for (const name of INSTRUMENT_NAMES.filter((n) => INSTRUMENTS[n].descriptor.sustained)) {
    it(name, () => {
      const short = note(name, 72, RATE, 0.5);
      const long = note(name, 72, RATE, 1.5);
      expect((long.length - short.length) / RATE).toBeCloseTo(1, 2);
      // Still sounding at 1.2 s when held for 1.5 s, gone when held for 0.5 s.
      expect(Math.abs(long[Math.round(1.2 * RATE)] ?? 0) + Math.abs(long[Math.round(1.2 * RATE) + 25] ?? 0)).toBeGreaterThan(0);
      expect(short.length / RATE).toBeLessThan(1.2);
    });
  }
});

describe("every shipped example", () => {
  const dir = new URL("../examples/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it.each(files)("%s renders cleanly at the loudness target (or says why not)", (file) => {
    const score = parseScore(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    const { audio, stats, timing } = render(score);
    expect(audio.every((channel) => channel.every(Number.isFinite))).toBe(true);
    expect(truePeak(audio)).toBeLessThanOrEqual(-1.5);
    if (!stats.limitedByPeak) expect(Math.abs(integratedLoudness(audio, RATE) - score.master.loudness)).toBeLessThanOrEqual(0.5);
    expect(timing.notes.length).toBeGreaterThan(0);
    // Golden hash of the PCM: changes only when a sound is changed on purpose (update the
    // snapshot in the same commit, after rendering and listening).
    const hash = createHash("sha256");
    for (const channel of audio) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
    expect(hash.digest("hex")).toMatchSnapshot();
  });
});
