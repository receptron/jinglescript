import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIDI_MIME_TYPE, parseScore, render, scoreToMidi, toPlayerData, toWav } from "../src/index.ts";
import { dataUri } from "../src/player.ts";
import { tagsOf } from "../src/tags.ts";

const score = parseScore(JSON.parse(readFileSync(new URL("../examples/lyrics-hatena.json", import.meta.url), "utf8")));
const base64 = (uri: string) => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");

describe("dataUri", () => {
  // btoa over chunks must give exactly Buffer's base64, at every length and across chunk edges.
  it("encodes as Buffer does, for lengths around every padding case and chunk boundary", () => {
    const lengths = [...Array.from({ length: 300 }, (_, i) => i), 0x7fff, 0x8000, 0x8001, 3 * 0x8000 + 7, 1_000_000];
    for (const length of lengths) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + length * 7) & 255);
      expect(dataUri("x/y", bytes)).toBe(`data:x/y;base64,${Buffer.from(bytes).toString("base64")}`);
    }
  });
});

describe("toPlayerData", () => {
  const result = render(score);
  const data = toPlayerData(score, result, "stem");

  it("embeds a tagged 16-bit WAV and the MIDI file", () => {
    expect(data.mimeType).toBe("audio/wav");
    expect(base64(data.audio)).toEqual(Buffer.from(toWav(result.audio, result.sampleRate, 16, tagsOf(score))));
    expect(data.midi.startsWith(`data:${MIDI_MIME_TYPE};base64,`)).toBe(true);
    expect(base64(data.midi)).toEqual(Buffer.from(scoreToMidi(score)));
  });

  it("carries the timing map, the tracks and peaks within 0–1", () => {
    expect(data.timing).toBe(result.timing);
    expect(data.tracks).toEqual(score.tracks.map((t) => t.name ?? t.instrument));
    expect(data.peaks.length).toBeGreaterThan(100);
    expect(data.peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(data.title).toBe(score.title ?? "stem");
  });

  it("takes audio the caller encoded instead", () => {
    expect(toPlayerData(score, result, "stem", { audio: "data:audio/mpeg;base64,", mimeType: "audio/mpeg" }).mimeType).toBe("audio/mpeg");
  });
});
