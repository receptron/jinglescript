import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blocksInstrument, builtinDefinition } from "../src/custom/instruments.ts";
import { BlocksDefinitionSchema, DefinitionSchema, type BlocksDefinition } from "../src/custom/schema.ts";
import { fft } from "../src/dsp/fft.ts";
import { integratedLoudness } from "../src/dsp/loudness.ts";
import { MAX_PARTIAL_FRACTION } from "../src/instruments/common.ts";
import { INSTRUMENTS, type Instrument, type InstrumentName } from "../src/instruments/index.ts";
import { expandScore } from "../src/events.ts";
import { AUTHORING_GUIDE } from "../src/guide.ts";
import { checkScore, getInstrument, getSchema, parseScore, render } from "../src/index.ts";
import { midiToFrequency } from "../src/pitch.ts";
import { createRng, type Rng } from "../src/rng.ts";

const RATE = 48000;
const play = (instrument: Instrument, midi: number | undefined, hold = 1, seed = 7): Float32Array => {
  const frequency = midi === undefined ? undefined : midiToFrequency(midi + instrument.descriptor.transpose);
  return instrument.synthesize({ midi, frequency, velocity: 1, hold, variant: undefined, sampleRate: RATE, rng: createRng(seed) });
};
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const hash = (x: Float32Array) =>
  createHash("sha256")
    .update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
    .digest("hex");

function spectrum(x: Float32Array, start: number): number[] {
  const n = 8192;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  return Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k] ?? 0, im[k] ?? 0));
}
/** Frequency of the strongest bin in the first 8192 samples, Hz. */
const pitchOf = (x: Float32Array): number => {
  const m = spectrum(x, 0);
  let best = 1;
  for (let k = 1; k < m.length; k++) if ((m[k] ?? 0) > (m[best] ?? 0)) best = k;
  return (best * RATE) / 8192;
};
const centroid = (m: number[]) => (m.reduce((s, v, k) => s + v * k, 0) / m.reduce((s, v) => s + v, 0)) * (RATE / 8192);
const correlation = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
/** RMS level in dB of [t, t + 0.1 s). */
function rmsDb(x: Float32Array, t: number): number {
  let sum = 0;
  const a = Math.round(t * RATE);
  const n = Math.round(0.1 * RATE);
  for (let i = a; i < a + n; i++) sum += (x[i] ?? 0) ** 2;
  return 10 * Math.log10(sum / n + 1e-30);
}
/**
 * Share of the energy above the partial limit in an 8192-sample window from `start`. Measured from
 * 3 % above the limit: a partial allowed just below it leaks a little into the next bins.
 */
function energyAboveLimit(x: Float32Array, start: number): number {
  const power = spectrum(x, start).map((m) => m * m);
  const total = power.reduce((s, v) => s + v, 0);
  const above = power.reduce((s, v, k) => s + ((k * RATE) / 8192 > 1.03 * RATE * MAX_PARTIAL_FRACTION ? v : 0), 0);
  return total === 0 ? 0 : above / total;
}

const base = { format: "jinglescript/1", tempo: 120, length: { seconds: 4 } };
const withInstruments = (instruments: unknown, tracks: unknown[] = [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }]) => ({
  ...base,
  instruments,
  tracks,
});
const errorsOf = (instruments: unknown, tracks?: unknown[]) => checkScore(withInstruments(instruments, tracks)).errors;

describe("built-ins written as blocks sound like the built-ins", () => {
  const names: InstrumentName[] = ["marimba", "xylophone", "glockenspiel", "vibraphone", "musicbox", "ukulele", "organ"];
  it.each(names)("%s: same spectrum, same decay, same loudness", (name) => {
    const definition = builtinDefinition(name);
    expect(definition).toBeDefined();
    if (definition === undefined) return;
    const blocks = blocksInstrument(definition);
    for (const midi of [60, 72, 84]) {
      const code = play(INSTRUMENTS[name], midi);
      // The definition has no written-to-sounding transpose: play the sounding pitch.
      const ours = play(blocks, midi + INSTRUMENTS[name].descriptor.transpose);
      const a = spectrum(code, 2400);
      const b = spectrum(ours, 2400);
      expect(correlation(a, b)).toBeGreaterThan(0.99);
      expect(Math.abs(centroid(b) / centroid(a) - 1)).toBeLessThan(0.05);
      expect(Math.abs(integratedLoudness([ours, ours], RATE) - integratedLoudness([code, code], RATE))).toBeLessThan(1);
      // Decay, relative to the first 100 ms, while the built-in is still above -50 dB.
      for (const t of [0.1, 0.5, 1]) {
        const fall = rmsDb(code, t) - rmsDb(code, 0);
        if (fall > -50) expect(Math.abs(fall - (rmsDb(ours, t) - rmsDb(ours, 0)))).toBeLessThan(1.5);
      }
    }
  });

  it("are shown by getInstrument, as valid definitions an LLM can copy", () => {
    const info = getInstrument("glockenspiel");
    expect(DefinitionSchema.safeParse(info?.definition).success).toBe(true);
    expect(getInstrument("piano")?.definition).toBeUndefined();
    expect(getSchema("instrument")).toMatchObject({ title: "jinglescript/1 instrument" });
  });
});

describe("the authoring guide's custom instruments", () => {
  it("are all valid", () => {
    const section = AUTHORING_GUIDE.slice(AUTHORING_GUIDE.indexOf("## Custom instruments"), AUTHORING_GUIDE.indexOf("## Lyrics"));
    const snippets = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => (m[1] ?? "").trim());
    expect(snippets.length).toBeGreaterThanOrEqual(3);
    for (const snippet of snippets) {
      const parsed: unknown = JSON.parse(snippet.startsWith('"instruments"') ? `{${snippet}}` : `{"instruments": {${snippet}}}`);
      const instruments = z.object({ instruments: z.record(z.string(), z.unknown()) }).parse(parsed).instruments;
      expect(errorsOf(instruments)).toEqual([]);
    }
  });
});

describe("custom instruments in a score", () => {
  const score = withInstruments(
    {
      softBell: { base: "glockenspiel", params: { decay: 1.5, brightness: -0.4 } },
      bigHit: { layers: [{ base: "piano" }, { base: "impact", variant: "soft", gain: -8 }, { base: "glockenspiel", transpose: 12, gain: -12 }] },
      zap: {
        kind: "sfx",
        pitch: "C7",
        blocks: [{ osc: "square", level: 0.6 }, { pitchEnv: { from: 0, to: -36, time: 0.25, curve: "linear" } }, { env: { attack: 0.002, decay: 0.3 } }],
      },
    },
    [
      { instrument: "softBell", notes: [{ at: 0, pitch: "E5" }] },
      { instrument: "bigHit", notes: [{ at: 2, pitch: ["C4", "E4", "G4"] }] },
      { instrument: "zap", notes: [{ at: 1 }, { at: 1.5, pitch: "E7" }] },
    ],
  );

  it("validates, renders deterministically, and names them in the timing map", () => {
    expect(checkScore(score)).toMatchObject({ ok: true, errors: [] });
    const first = render(parseScore(score));
    const second = render(parseScore(score));
    expect(first.audio[0].every(Number.isFinite)).toBe(true);
    expect(hash(first.audio[0])).toBe(hash(second.audio[0]));
    expect(first.timing.notes.map((n) => n.instrument)).toEqual(["softBell", "zap", "zap", "bigHit"]);
    expect(first.stats.loudness).toBeGreaterThan(-14.6);
  });

  it("do not change scores without them", () => {
    const plain = { ...base, tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }] };
    expect(hash(render(parseScore(plain)).audio[0])).toBe(hash(render(parseScore({ ...plain, instruments: {} })).audio[0]));
  });
});

describe("tweaks and layers", () => {
  /** The custom instrument "x" a definition makes, as the renderer gets it. */
  const custom = (definition: unknown): Instrument => {
    const instrument = expandScore(parseScore(withInstruments({ x: definition }))).instruments.get("x");
    if (instrument === undefined) throw new Error("no instrument x");
    return instrument;
  };
  const tail = (x: Float32Array) => rmsDb(x, 2.5) - rmsDb(x, 0);

  it("gain and transpose do what they say", () => {
    const plain = play(custom({ base: "marimba" }), 72);
    expect(20 * Math.log10(peakOf(play(custom({ base: "marimba", gain: -12 }), 72)) / peakOf(plain))).toBeCloseTo(-12, 1);
    const up = play(custom({ base: "marimba", transpose: 12 }), 60);
    expect(correlation(spectrum(up, 2400), spectrum(plain, 2400))).toBeGreaterThan(0.99);
  });

  it("decay above 1 lengthens a built-in that has a definition; below 1 shortens any ringing one", () => {
    expect(tail(play(custom({ base: "glockenspiel", params: { decay: 2 } }), 72))).toBeGreaterThan(tail(play(INSTRUMENTS.glockenspiel, 72)) + 3);
    const piano = play(INSTRUMENTS.piano, 60);
    const damped = play(custom({ base: "piano", params: { decay: 0.3 } }), 60);
    expect(damped.length).toBeLessThan(piano.length * 0.35);
    expect(rmsDb(damped, 0.4) - rmsDb(damped, 0)).toBeLessThan(rmsDb(piano, 0.4) - rmsDb(piano, 0) - 6);
  });

  it("brightness moves the tone colour", () => {
    const tone = (brightness: number) => centroid(spectrum(play(custom({ base: "piano", params: { brightness } }), 60), 2400));
    expect(tone(-0.8)).toBeLessThan(tone(0) * 0.8);
    expect(tone(0.8)).toBeGreaterThan(tone(0) * 1.1);
  });

  it("attack softens the onset", () => {
    const x = play(custom({ base: "marimba", params: { attack: 0.08 } }), 72);
    expect(peakOf(x.subarray(0, Math.round(0.02 * RATE)))).toBeLessThan(0.4 * peakOf(x));
  });

  it("transpose moves an effect's default pitch when the note gives none", () => {
    const zap = { kind: "sfx", pitch: "C6", blocks: [{ osc: "sine" }, { env: { attack: 0.002, decay: 0.5 } }] };
    const plain = expandScore(parseScore(withInstruments({ zap, x: { base: "zap", transpose: 12 } }))).instruments;
    const lower = plain.get("zap");
    const higher = plain.get("x");
    if (lower === undefined || higher === undefined) throw new Error("missing");
    expect(pitchOf(play(higher, undefined)) / pitchOf(play(lower, undefined))).toBeCloseTo(2, 1);
    expect(pitchOf(play(custom({ base: "pop", transpose: -12 }), undefined))).toBeLessThan(pitchOf(play(INSTRUMENTS.pop, undefined)) * 0.6);
  });

  it("a bare oscillator stops after its hold, even beside a ringing source", () => {
    const x = play(custom({ blocks: [{ osc: "sine" }, { modes: [{ ratio: 2, level: 0, decay: 3 }] }] }), 72, 0.1);
    expect(rmsDb(x, 0.4) - rmsDb(x, 0)).toBeLessThan(-60);
  });

  it("a transposed layer takes notes in its written range", () => {
    const up = {
      layers: [
        { base: "marimba", transpose: 24 },
        { base: "marimba", transpose: 24 },
      ],
    };
    expect(errorsOf({ x: up }, [{ instrument: "x", notes: [{ at: 0, pitch: "C1" }] }])).toEqual([]);
    expect(errorsOf({ x: up }, [{ instrument: "x", notes: [{ at: 0, pitch: "C7" }] }])[0]?.message).toContain("outside");
  });

  it("rejects layers whose ranges do not overlap", () => {
    const apart = {
      layers: [
        { base: "marimba", transpose: 24 },
        { base: "piccolo", transpose: -24 },
      ],
    };
    expect(errorsOf({ x: apart })[0]).toMatchObject({ path: "instruments.x.layers", hint: "Transpose the layers so their ranges overlap." });
  });

  it("a held note that ends during its attack releases from where it is, without a jump", () => {
    const x = play(custom({ blocks: [{ osc: "sine" }, { env: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.01 } }] }), 72, 0.02);
    const peak = peakOf(x);
    // Before the fix the envelope kept rising to 0.1 s and then fell to zero in one step.
    expect(peakOf(x.subarray(Math.round(0.05 * RATE)))).toBeLessThan(0.01 * peak);
  });

  it("an effect longer than the cap is an error, so audio and timing agree", () => {
    const hum = { kind: "sfx", length: 1, blocks: [{ noise: "pink", env: { attack: 0.01, decay: 1, sustain: 1, release: 0.1 } }] };
    const tracks = [{ instrument: "hum", notes: [{ end: { seconds: 15 }, len: { seconds: 15 } }] }];
    expect(checkScore({ ...base, length: { seconds: 16 }, instruments: { hum }, tracks }).errors[0]).toMatchObject({ path: "tracks[0].notes[0].len" });
  });

  it("transpose moves a stack of effects when the note gives no pitch", () => {
    const ping = { kind: "sfx", pitch: "C6", blocks: [{ osc: "sine" }, { env: { attack: 0.002, decay: 0.5 } }] };
    const instruments = expandScore(
      parseScore(withInstruments({ ping, stack: { layers: [{ base: "ping" }, { base: "ping", gain: -6 }] }, up: { base: "stack", transpose: 12 } })),
    ).instruments;
    const stack = instruments.get("stack");
    const up = instruments.get("up");
    if (stack === undefined || up === undefined) throw new Error("missing");
    expect(pitchOf(play(up, undefined)) / pitchOf(play(stack, undefined))).toBeCloseTo(2, 1);
  });

  it("a stack with a length still ends at its len when a layer is delayed", () => {
    const rise = custom({ layers: [{ base: "riser" }, { base: "riser", variant: "tone", delay: 1 }] });
    const x = play(rise, undefined, 2);
    expect(x.length).toBe(2 * RATE);
  });

  it("a very short hold still plays every ringing layer", () => {
    const x = play(custom({ layers: [{ base: "marimba" }, { base: "glockenspiel", delay: 0.05 }] }), 72, 0.01);
    expect(rmsDb(x, 0.1)).toBeGreaterThan(rmsDb(play(INSTRUMENTS.marimba, 72), 0.1));
  });

  it("on a chord, a layer without pitch plays once", () => {
    const hit = custom({ layers: [{ base: "piano" }, { base: "impact" }] });
    const voice = (chordVoice: number) =>
      hit.synthesize({ midi: 60, frequency: midiToFrequency(60), velocity: 1, hold: 1, variant: undefined, sampleRate: RATE, rng: createRng(7), chordVoice });
    const piano = (chordVoice: number) =>
      custom({ base: "piano" }).synthesize({
        midi: 60,
        frequency: midiToFrequency(60),
        velocity: 1,
        hold: 1,
        variant: undefined,
        sampleRate: RATE,
        rng: createRng(7),
        chordVoice,
      });
    // The second pitch of a chord is the piano alone: no second boom.
    expect(rmsDb(voice(1), 0.3)).toBeLessThan(rmsDb(voice(0), 0.3) - 3);
    expect(Math.abs(rmsDb(voice(1), 0.3) - rmsDb(piano(1), 0.3))).toBeLessThan(3);
  });

  it("layers play together, each with its own delay", () => {
    const x = play(custom({ layers: [{ base: "marimba" }, { base: "pop", delay: 0.5 }] }), 72);
    const marimba = play(INSTRUMENTS.marimba, 72);
    expect(rmsDb(x, 0.3)).toBeCloseTo(rmsDb(marimba, 0.3), 1);
    expect(rmsDb(x, 0.5) - rmsDb(marimba, 0.5)).toBeGreaterThan(3);
  });
});

describe("custom levels are balanced against the marimba", () => {
  it("by loudness for a sound that rings", () => {
    const pad = blocksInstrument(
      BlocksDefinitionSchema.parse({ blocks: [{ osc: "saw" }, { filter: "lowpass", cutoff: 2000 }, { env: { attack: 0.01, decay: 1 } }] }),
    );
    const x = play(pad, 72);
    const marimba = play(INSTRUMENTS.marimba, 72);
    expect(Math.abs(integratedLoudness([x, x], RATE) - integratedLoudness([marimba, marimba], RATE))).toBeLessThan(0.5);
  });

  it("by peak for a click", () => {
    const click = blocksInstrument(BlocksDefinitionSchema.parse({ kind: "sfx", blocks: [{ noise: "white", burst: 0.003 }] }));
    const values = [1, 2, 3, 4, 5].map((seed) => peakOf(play(click, undefined, 1, seed)));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(20 * Math.log10(mean / peakOf(play(INSTRUMENTS.marimba, 72))))).toBeLessThan(1.5);
  });
});

describe("definition errors (written for repair)", () => {
  it("rejects a name taken by a built-in", () => {
    expect(errorsOf({ piano: { base: "marimba" } })).toEqual([
      { path: "instruments.piano", message: '"piano" is a built-in instrument.', hint: 'Give yours another name, e.g. "myPiano".' },
    ]);
  });

  it("names an unknown base and lists what exists", () => {
    const [error] = errorsOf({ x: { base: "kazoo" } });
    expect(error).toMatchObject({ path: "instruments.x.base", message: 'Unknown base "kazoo".' });
    expect(error?.hint).toContain("glockenspiel");
  });

  it("finds a loop of bases", () => {
    expect(errorsOf({ a: { base: "b" }, b: { base: "a" } })[0]?.message).toContain("loop");
  });

  it("checks variants, transposes and decays against the base", () => {
    expect(errorsOf({ x: { base: "impact", variant: "huge" } })[0]).toMatchObject({ path: "instruments.x.variant", hint: "Variants: soft, hard." });
    expect(errorsOf({ x: { base: "impact", transpose: 2 } })[0]?.path).toBe("instruments.x.transpose");
    expect(errorsOf({ x: { base: "piano", params: { decay: 2 } } })[0]?.path).toBe("instruments.x.params.decay");
    expect(errorsOf({ x: { base: "organ", params: { decay: 0.5 } } })).toEqual([]);
  });

  it("points into a block that has a bad field, by the block's key", () => {
    expect(errorsOf({ x: { blocks: [{ osc: "sawtooth" }] } })[0]?.path).toBe("instruments.x.blocks[0].osc");
    expect(errorsOf({ x: { blocks: [{ osc: "saw", lvl: 1 }] } })[0]).toMatchObject({ path: "instruments.x.blocks[0]", message: 'Unknown field "lvl".' });
    expect(errorsOf({ x: { blocks: [{ wave: "saw" }] } })[0]?.message).toContain("osc, modes, noise");
    expect(errorsOf({ x: { sound: "saw" } })[0]?.message).toContain('"blocks"');
  });

  it("needs a source, one env, and a pitch for a pitched effect", () => {
    expect(errorsOf({ x: { blocks: [{ env: {} }] } })[0]?.message).toBe("No sound source.");
    expect(errorsOf({ x: { blocks: [{ osc: "sine" }, { env: {} }, { env: {} }] } })[0]?.message).toBe("More than one `env` block.");
    expect(errorsOf({ x: { kind: "sfx", blocks: [{ osc: "sine" }] } })[0]?.path).toBe("instruments.x.pitch");
    expect(errorsOf({ x: { blocks: [{ osc: "sine" }], length: 1 } })[0]?.path).toBe("instruments.x.length");
    expect(errorsOf({ x: { blocks: [{ noise: "white", burst: 0.01, decay: 0.2 }] } })[0]?.path).toBe("instruments.x.blocks[0]");
    // A source's own env is not a second env block.
    expect(errorsOf({ x: { blocks: [{ osc: "sine", env: {} }, { osc: "saw", env: {} }, { env: {} }] } })).toEqual([]);
    expect(errorsOf({ x: { blocks: [{ string: {} }, { lfo: "vibrato" }] } })[0]?.message).toContain("keeps its pitch");
    // Each LFO kind has a default depth of its own.
    expect(errorsOf({ x: { blocks: [{ osc: "sine" }, { lfo: "tremolo" }, { lfo: "vibrato" }] } })).toEqual([]);
  });

  it("checks notes against a custom instrument like a built-in", () => {
    const unpitched = { x: { blocks: [{ noise: "white", decay: 0.1 }] } };
    expect(errorsOf(unpitched, [{ instrument: "x", notes: [{ at: 0, pitch: "C4" }] }])[0]?.message).toBe('"x" is unpitched and takes no pitch.');
    expect(errorsOf({}, [{ instrument: "kazoo", notes: [{ at: 0 }] }])[0]).toMatchObject({
      path: "tracks[0].instrument",
      message: 'Unknown instrument "kazoo".',
    });
  });
});

/** A random valid definition: any mix of blocks with any settings in range. */
function randomDefinition(rng: Rng): BlocksDefinition {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng.next() * items.length)] as T;
  const between = (low: number, high: number) => low + rng.next() * (high - low);
  const logBetween = (low: number, high: number) => low * (high / low) ** rng.next();
  const env = () => ({
    attack: logBetween(0.001, 0.3),
    decay: logBetween(0.02, 3),
    sustain: rng.next() < 0.5 ? 0 : between(0, 1),
    release: logBetween(0.01, 1.5),
  });
  const filter = () => ({ cutoff: logBetween(40, 18000), q: between(0.3, 12), sweep: between(-6, 6), sweepTime: logBetween(0.005, 2) });
  const sources = [
    () => ({
      osc: pick(["sine", "triangle", "saw", "square", "pulse"] as const),
      ratio: logBetween(0.125, 16),
      detune: between(-100, 100),
      width: between(0.05, 0.95),
      level: between(0, 1),
      ...(rng.next() < 0.4 ? { env: env() } : {}),
    }),
    () => ({
      modes: Array.from({ length: 1 + Math.floor(rng.next() * 6) }, () => ({ ratio: logBetween(0.25, 40), level: between(0, 1), decay: logBetween(0.01, 4) })),
      lowRingsLonger: between(0, 2),
    }),
    () => {
      const shape = pick(["burst", "decay", "env"] as const);
      const shapings = { burst: () => ({ burst: logBetween(0.0005, 0.2) }), decay: () => ({ decay: logBetween(0.005, 2) }), env: () => ({ env: env() }) };
      const shaping = shapings[shape]();
      return {
        noise: pick(["white", "pink"] as const),
        level: between(0, 1),
        ...shaping,
        ...(rng.next() < 0.5 ? { filter: { type: pick(["lowpass", "highpass", "bandpass"] as const), ...filter() } } : {}),
        at: between(0, 0.3),
      };
    },
    () => ({
      string: { pluck: logBetween(100, 10000), position: between(0.05, 0.5), damping: between(0, 0.9), ring: logBetween(0.1, 3), body: logBetween(500, 16000) },
      level: between(0, 1),
    }),
  ];
  const blocks: unknown[] = Array.from({ length: 1 + Math.floor(rng.next() * 3) }, () => pick(sources)());
  if (rng.next() < 0.5) blocks.push({ env: env() });
  if (rng.next() < 0.4) blocks.push({ filter: pick(["lowpass", "highpass", "bandpass"] as const), ...filter() });
  if (rng.next() < 0.3)
    blocks.push({ pitchEnv: { from: between(-48, 48), to: between(-48, 48), time: logBetween(0.001, 2), curve: pick(["linear", "exp"] as const) } });
  if (rng.next() < 0.2) blocks.push({ lfo: "vibrato", rate: logBetween(0.1, 40), depth: between(0, 100), delay: between(0, 0.5) });
  if (rng.next() < 0.2) blocks.push({ lfo: "tremolo", rate: logBetween(0.1, 40), depth: between(0, 1), delay: between(0, 0.5) });
  const sfx = rng.next() < 0.3;
  return BlocksDefinitionSchema.parse({
    kind: sfx ? "sfx" : "instrument",
    ...(sfx ? { pitch: "C6", ...(rng.next() < 0.5 ? { length: between(0.1, 2) } : {}) } : {}),
    blocks,
  });
}

describe("fuzz: random valid definitions render cleanly", () => {
  const rng = createRng(20261008);
  const definitions = Array.from({ length: 150 }, () => randomDefinition(rng));
  it.each(definitions.map((d, i) => [i, d] as const))(
    "definition %i: finite, onset ramp, ends in silence, no DC, nothing above the partial limit, capped",
    (_i, definition) => {
      const instrument = blocksInstrument(definition);
      const pitched = instrument.descriptor.pitched;
      // Noise is not aliasing, and neither is a plucked string: it is computed at the sample rate, so
      // nothing folds back, and its harmonics run up to Nyquist as a real string's do.
      const tonal = (pitched || instrument.descriptor.pitchOptional === true) && !definition.blocks.some((b) => "noise" in b || "string" in b);
      const cap = 4 * peakOf(play(INSTRUMENTS.marimba, 72)) * 1.0001;
      for (const midi of pitched ? [36, 60, 96] : [undefined]) {
        const x = play(instrument, midi, 0.5);
        expect(x.every(Number.isFinite)).toBe(true);
        expect(Math.abs(x[0] ?? 1)).toBe(0);
        const peak = peakOf(x);
        expect(peak).toBeLessThanOrEqual(cap);
        if (peak === 0) continue;
        expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(1e-4 * peak);
        expect(Math.abs(x.reduce((s, v) => s + v, 0) / x.length) / peak).toBeLessThan(0.005);
        if (tonal && x.length > 0.2 * RATE + 8192) expect(energyAboveLimit(x, Math.round(0.2 * RATE))).toBeLessThan(1e-4);
        expect(hash(x)).toBe(hash(play(instrument, midi, 0.5)));
      }
    },
  );
});

describe("fuzz: random tweaks and layers of built-ins render cleanly", () => {
  const rng = createRng(1008);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng.next() * items.length)] as T;
  const between = (low: number, high: number) => low + rng.next() * (high - low);
  const names = Object.keys(INSTRUMENTS) as InstrumentName[];
  const layer = (inLayers: boolean) => {
    const name = pick(names);
    const d = INSTRUMENTS[name].descriptor;
    const ringsOut = !d.sustained && d.duration === undefined;
    const params = {
      ...(rng.next() < 0.5 ? { brightness: between(-1, 1) } : {}),
      ...(rng.next() < 0.4 ? { attack: between(0.001, 0.3) } : {}),
      ...(ringsOut && rng.next() < 0.4 ? { decay: between(0.25, 1) } : {}),
    };
    return {
      base: name,
      params,
      ...(d.variants.length > 0 && rng.next() < 0.5 ? { variant: pick(d.variants) } : {}),
      ...(d.pitched && rng.next() < 0.4 ? { transpose: Math.round(between(-12, 12)) } : {}),
      gain: between(-12, 6),
      ...(inLayers && rng.next() < 0.3 ? { delay: between(0, 0.5) } : {}),
    };
  };
  const definitions = Array.from({ length: 40 }, () => {
    if (rng.next() < 0.5) return layer(false);
    return { layers: Array.from({ length: 2 + Math.floor(rng.next() * 3) }, () => layer(true)) };
  });
  it.each(definitions.map((d, i) => [i, d] as const))("definition %i: finite, onset ramp, ends in silence, no DC, capped", (_i, definition) => {
    const checked = checkScore(withInstruments({ x: definition }));
    expect(checked.errors).toEqual([]);
    const instrument = expandScore(parseScore(withInstruments({ x: definition }))).instruments.get("x");
    if (instrument === undefined) throw new Error("no instrument x");
    const cap = 4 * peakOf(play(INSTRUMENTS.marimba, 72)) * 1.0001;
    const takesPitch = instrument.descriptor.pitched;
    const length = instrument.descriptor.duration?.defaultSeconds ?? 0.5;
    for (const midi of takesPitch ? [60, 72] : [undefined]) {
      const x = play(instrument, midi, length);
      const peak = peakOf(x);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(Math.abs(x[0] ?? 1)).toBe(0);
      expect(peak).toBeLessThanOrEqual(cap);
      if (peak === 0) continue;
      expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(1e-4 * peak);
      expect(Math.abs(x.reduce((s, v) => s + v, 0) / x.length) / peak).toBeLessThan(0.005);
    }
  });
});
