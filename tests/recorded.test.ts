import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTRUMENT_NAMES, INSTRUMENTS } from "../src/instruments/index.ts";
import { parseScore, render } from "../src/index.ts";
import { createRng } from "../src/rng.ts";
import { BUNDLED_SFX_DIR } from "../src/samples/bundled.ts";
import { loadSamples } from "../src/samples/load.ts";
import { readWavLayout } from "../src/samples/wav-read.ts";
import { allTakes, RECORDED_EFFECTS, SFX_SAMPLE_RATE } from "../src/sounds/recorded-catalog.ts";
import { fixtureSamples } from "./sample-fixture.ts";

const scoreWith = (instrument: string, notes: unknown[]) =>
  parseScore({ format: "jinglescript/1", tempo: 120, length: { seconds: 4 }, tracks: [{ instrument, notes }] });
const hash = (audio: Float32Array[]) =>
  createHash("sha256")
    .update(new Uint8Array(audio[0]?.buffer ?? new ArrayBuffer(0)))
    .digest("hex");
/** A fetch that fails the test: the recorded effects must never touch the network. */
const noNetwork: typeof fetch = () => Promise.reject(new Error("network used"));

describe("recorded sound effects", () => {
  it("has a mono WAV at the stored rate in samples/sfx/ for every take, each listed in SOURCES.md", () => {
    const sources = readFileSync(join(BUNDLED_SFX_DIR, "SOURCES.md"), "utf8");
    for (const take of allTakes()) {
      const layout = readWavLayout(new Uint8Array(readFileSync(join(BUNDLED_SFX_DIR, `${take.file}.wav`))));
      expect(layout).toMatchObject({ channels: 1, sampleRate: SFX_SAMPLE_RATE, bits: 16 });
      expect(sources).toContain(`\`${take.file}.wav\` | \`${take.source}\``);
    }
  });

  it("are registered under their catalog names, with the catalog's variants", () => {
    for (const [name, variants] of Object.entries(RECORDED_EFFECTS)) {
      expect(INSTRUMENT_NAMES).toContain(name);
      const descriptor = INSTRUMENTS[name as keyof typeof INSTRUMENTS].descriptor;
      expect(descriptor.sampled?.bundled).toBe(true);
      const names = Object.keys(variants);
      if (names.length > 1) for (const v of names) expect(descriptor.variants).toContain(v);
    }
  });

  it("loads from the package without the network, and renders", async () => {
    const score = scoreWith("door", [{ at: 0 }, { at: 1, variant: "creak" }]);
    await expect(render(score)).rejects.toThrow(/loadSamples/);
    const samples = await loadSamples(score, { fetch: noNetwork, download: false });
    const { audio, stats } = await render(score, { samples });
    expect(audio[0]?.some((v) => Math.abs(v) > 0.01)).toBe(true);
    expect(Number.isFinite(stats.truePeak)).toBe(true);
  });

  it("plays footstep surfaces from recordings and left/right steps from the model", async () => {
    const synthesized = scoreWith("footsteps", [{ at: 0, variant: "left" }]);
    await expect(render(synthesized)).resolves.toBeDefined();
    const surfaces = scoreWith("footsteps", [{ at: 0, variant: ["wood", "snow"], repeat: { every: 1, count: 4 } }]);
    const samples = await loadSamples(surfaces, { fetch: noNetwork, download: false });
    expect((await render(surfaces, { samples })).audio[0]?.some((v) => Math.abs(v) > 0.01)).toBe(true);
  });

  it("chooses among a variant's takes by the seed: both get played, and the same seed gives the same audio", async () => {
    const door = INSTRUMENTS.door;
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const x = door.synthesize({
        midi: undefined,
        frequency: undefined,
        velocity: 1,
        hold: 1,
        variant: "close",
        sampleRate: 48000,
        rng: createRng(seed),
        samples: fixtureSamples,
      });
      firsts.add(x.length);
    }
    expect(firsts.size).toBe(2);
    const score = scoreWith("dice", [{ at: 0, repeat: { every: 0.5, count: 6 } }]);
    expect(hash((await render(score, { samples: fixtureSamples })).audio)).toBe(hash((await render(score, { samples: fixtureSamples })).audio));
  });
});
