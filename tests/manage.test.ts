import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../src/encode.ts";
import { manage, manageInputJsonSchema } from "../src/manage.ts";

const hasFfmpeg = await ffmpegAvailable();
const score = {
  format: "jinglescript/1",
  title: "Test sting",
  tempo: 120,
  length: { seconds: 3 },
  cues: { hit: { seconds: 1 } },
  tracks: [
    {
      instrument: "marimba",
      notes: [
        { at: 0, pitch: "G4" },
        { at: "hit", chord: "C" },
      ],
    },
  ],
};

describe("manageJingleScript, carried by any protocol", () => {
  it("renders player data for a view: embedded audio, waveform peaks, the timing map, the score and its MIDI", async () => {
    const result = await manage({ action: "renderScore", score }, { player: true });
    expect(result.isError).toBe(false);
    const player = result.player;
    expect(player?.title).toBe("Test sting");
    expect(player?.mimeType).toBe(hasFfmpeg ? "audio/mpeg" : "audio/wav");
    expect(player?.audio.startsWith(`data:${player.mimeType};base64,`)).toBe(true);
    expect(player?.peaks.length).toBeGreaterThan(500);
    expect(Math.max(...(player?.peaks ?? []))).toBeLessThanOrEqual(1);
    expect(player?.timing.cues).toEqual({ hit: 1 });
    expect(player?.tracks).toEqual(["marimba"]);
    expect(player?.score).toMatchObject({ title: "Test sting", tempo: 120 });
    expect(player?.midi.startsWith("data:audio/midi;base64,TVRoZA")).toBe(true);
  });

  it("writes no files without an output folder, and no player data unless asked", async () => {
    const result = await manage({ action: "renderScore", score });
    expect(result.player).toBeUndefined();
    expect(JSON.parse(result.text)).not.toHaveProperty("audio");
  });

  it("returns a timing summary to the LLM unless the whole timing map is asked for", async () => {
    const summary = JSON.parse((await manage({ action: "renderScore", score })).text) as { timing: Record<string, unknown> };
    expect(summary.timing).toMatchObject({ tempo: 120, duration: 3, cues: { hit: 1 }, notesPerTrack: [2] });
    expect(summary.timing).not.toHaveProperty("notes");
    expect(summary.timing).not.toHaveProperty("beats");
    expect(summary.timing.omitted).toContain("includeTiming: true");
    const full = JSON.parse((await manage({ action: "renderScore", score, includeTiming: true })).text) as { timing: { notes: unknown[]; beats: unknown[] } };
    expect(full.timing.notes).toHaveLength(2);
    expect(full.timing.beats.length).toBeGreaterThan(0);
  });

  it("describes its input as an object JSON Schema for function-calling hosts", () => {
    expect(manageInputJsonSchema()).toMatchObject({ type: "object", required: ["action"] });
  });
});
