import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandScore } from "../src/events.ts";
import { integratedLoudness, parseScore, render, TimingSchema, toWav, truePeak } from "../src/index.ts";

const exampleA: unknown = JSON.parse(readFileSync(new URL("../examples/hatena-marumo-a.json", import.meta.url), "utf8"));
const pcmHash = (audio: readonly Float32Array[]) => {
  const hash = createHash("sha256");
  for (const channel of audio) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest("hex");
};

describe("example A (ハテナマルモ opening)", () => {
  const result = render(parseScore(exampleA));
  const [left, right] = result.audio;

  it("puts the hit cue at 1.500 s and every note in the timing map", () => {
    expect(TimingSchema.parse(result.timing)).toBeTruthy();
    expect(result.timing.cues).toEqual({ hit: 1.5, voice: 1.8 });
    expect(result.timing.notes).toHaveLength(8);
    expect(result.timing.notes.filter((n) => n.cue === "hit").map((n) => n.pitch)).toEqual([
      ["C5", "E5", "G5", "C6"],
      ["C3", "G3"],
    ]);
    expect(result.timing.notes.map((n) => n.t)).toEqual([0, 0.231, 0.462, 0.863, 1.023, 1.5, 1.5, 1.962]);
    expect(result.timing.beats.slice(0, 3)).toEqual([0, 0.462, 0.923]);
    expect(result.timing.audibleUntil).toBeGreaterThan(2);
    expect(result.timing.audibleUntil).toBeLessThanOrEqual(4.6);
  });

  it("is mastered to -14 ± 0.5 LUFS, true peak under -1.5 dBTP, no NaN, no DC", () => {
    expect(integratedLoudness(result.audio, 48000)).toBeGreaterThan(-14.5);
    expect(integratedLoudness(result.audio, 48000)).toBeLessThan(-13.5);
    expect(truePeak(result.audio)).toBeLessThanOrEqual(-1.5);
    for (const channel of [left, right]) {
      expect(channel.every(Number.isFinite)).toBe(true);
      const peak = channel.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(Math.abs(channel.reduce((s, v) => s + v, 0) / channel.length) / peak).toBeLessThan(0.005);
    }
    expect(result.audio[0]).toHaveLength(Math.round(4.6 * 48000));
  });

  it("is bit-identical on every render, and changes with the seed", () => {
    // Golden hash of the PCM at seed 1. It changes only when the sound is changed on purpose;
    // update it in the same commit, after rendering and listening.
    expect(pcmHash(result.audio)).toBe(pcmHash(render(parseScore(exampleA)).audio));
    expect(pcmHash(result.audio)).toMatchInlineSnapshot(`"b92380408cd7112b84f0d83d674b5799cc3ef605885f05f83b965ef1d9852ccc"`);
    expect(pcmHash(render(parseScore(exampleA), { seed: 2 }).audio)).not.toBe(pcmHash(result.audio));
  });

  it("writes a 24-bit and a 16-bit WAV", () => {
    const wav = toWav(result.audio, 48000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(wav).toHaveLength(44 + left.length * 2 * 3);
    expect(toWav(result.audio, 48000, 16)).toHaveLength(44 + left.length * 2 * 2);
  });
});

describe("onsets land on the timing map", () => {
  const scoreAt = (at: unknown) =>
    parseScore({
      format: "jinglescript/1",
      tempo: 130,
      length: { seconds: 3 },
      master: { reverb: "none", limiter: false },
      cues: { hit: { seconds: 1.5 } },
      tracks: [{ instrument: "marimba", notes: [{ at, pitch: "C5" }] }],
    });

  for (const at of [0.5, 1.75, { seconds: 0.863 }, "hit", "hit-0.25", "hit+1"]) {
    for (const sampleRate of [48000, 44100] as const) {
      it(`at ${JSON.stringify(at)}, ${sampleRate} Hz: sound starts on the onset's sample; the map is within 0.5 ms`, () => {
        const score = scoreAt(at);
        const exact = expandScore(score).events[0]?.seconds ?? NaN;
        const { audio, timing } = render(score, { sampleRate });
        // The marimba's first sample is 0 (the onset ramp), so the first non-zero one follows it.
        const onset = audio[0].findIndex((v) => v !== 0) - 1;
        expect(onset).toBe(Math.round(exact * sampleRate));
        expect(Math.abs((timing.notes[0]?.t ?? NaN) - onset / sampleRate)).toBeLessThanOrEqual(0.0005 + 1 / sampleRate);
      });
    }
  }
});
