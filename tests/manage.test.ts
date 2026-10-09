import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../src/encode.ts";
import { isScorePath, manage, ManageInputSchema, manageInputJsonSchema } from "../src/manage.ts";

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

  it("reads a score file named by `path` through the carrier's reader", async () => {
    const files: Record<string, string> = { "scores/opening.json": JSON.stringify(score), "scores/broken.json": "{ nope" };
    const readScoreFile = (path: string): Promise<string> => {
      const text = files[path];
      return text === undefined ? Promise.reject(new Error("ENOENT: no such file")) : Promise.resolve(text);
    };
    const checked = await manage({ action: "checkScore", path: "scores/opening.json" }, { readScoreFile });
    expect(JSON.parse(checked.text)).toMatchObject({ ok: true });
    const rendered = await manage({ action: "renderScore", path: "scores/opening.json" }, { readScoreFile, player: true });
    expect(rendered.player?.score.title).toBe("Test sting");
    const missing = await manage({ action: "renderScore", path: "scores/gone.json" }, { readScoreFile });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Cannot read scores/gone.json: ENOENT");
    expect(await manage({ action: "checkScore", path: "scores/broken.json" }, { readScoreFile })).toMatchObject({ isError: true });
    expect((await manage({ action: "checkScore", path: "../secret.json" }, { readScoreFile })).text).toContain("must name a .json file");
    expect((await manage({ action: "checkScore", path: "scores/opening.json" })).text).toContain("cannot read files");
  });

  it("takes `score` or `path`, exactly one, and checks a path's shape", () => {
    expect(ManageInputSchema.safeParse({ action: "renderScore", score, path: "a.json" }).error?.issues[0]?.message).toBe("Give `score` or `path`, not both.");
    expect(ManageInputSchema.safeParse({ action: "checkScore" }).error?.issues[0]?.message).toContain("needs `score` (the score itself) or `path`");
    expect(["opening.json", "scores/a.json", "/abs/a.json", "C:\\proj\\a.json"].map(isScorePath)).toEqual([true, true, true, true]);
    expect(["a.md", "../a.json", "scores/./a.json", "scores//a.json", "a\0.json"].map(isScorePath)).toEqual([false, false, false, false, false]);
  });

  it("describes its input as an object JSON Schema for function-calling hosts", () => {
    expect(manageInputJsonSchema()).toMatchObject({ type: "object", required: ["action"] });
  });
});
