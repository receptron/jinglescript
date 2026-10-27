import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ffmpegAvailable } from "../src/encode.ts";
import { awaitDeferredPlayer, deferRender } from "../src/deferred-renders.ts";
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
  it("gives the model a compact score schema that points to the custom-instrument format instead of including it", async () => {
    const text = (await manage({ action: "getSchema" })).text;
    expect(text).not.toContain("\n");
    const schema = z.object({ properties: z.object({ instruments: z.object({ description: z.string() }) }) }).parse(JSON.parse(text));
    expect(schema.properties.instruments.description).toContain('part "instrument"');
    expect(text).not.toContain('"blocks"');
    expect((await manage({ action: "getSchema", part: "instrument" })).text).toContain('"blocks"');
  });

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

describe("renderScore with deferAudio (a view that collects the audio later)", () => {
  it("answers with the finished player when the audio is ready in time", async () => {
    // A wait no machine misses, however loaded (the default is DEFER_WAIT_MS).
    const result = await manage({ action: "renderScore", score }, { player: true, deferAudio: { waitMs: 25_000 } });
    expect(result.player?.pending).toBeUndefined();
    expect(result.player?.audio.startsWith("data:")).toBe(true);
    expect(JSON.parse(result.text)).toHaveProperty("loudness");
  });

  it("otherwise answers at once with a pending player, and the view collects the finished one by id", async () => {
    const result = await manage({ action: "renderScore", score, view: "notation", autoplay: true }, { player: true, deferAudio: { waitMs: 0 } });
    const pending = result.player;
    expect(result.isError).toBe(false);
    expect(pending?.pending).toEqual(expect.any(String));
    expect(pending).toMatchObject({ audio: "", peaks: [], title: "Test sting", tracks: ["marimba"], duration: 3 });
    expect(pending?.timing.cues).toEqual({ hit: 1 });
    expect(pending?.presentation).toMatchObject({ autoplay: true });
    expect(JSON.parse(result.text)).toMatchObject({ ok: true, audio: expect.stringContaining("still rendering") });

    const outcome = await awaitDeferredPlayer(pending?.pending ?? "");
    if (outcome.kind !== "ready") throw new Error(`expected the finished player, got ${outcome.kind}`);
    const finished = outcome.player;
    expect(finished.pending).toBeUndefined();
    expect(finished.audio.startsWith("data:")).toBe(true);
    expect(finished.peaks.length).toBeGreaterThan(500);
    // The pending timing map is the finished one but for audibleUntil, measured on the audio.
    expect({ ...pending?.timing, audibleUntil: 0 }).toEqual({ ...finished.timing, audibleUntil: 0 });
    // Fresh from when the audio was ready, so a long render still autoplays.
    expect(finished.presentation?.renderedAt).toBeGreaterThanOrEqual(pending?.presentation?.renderedAt ?? Infinity);
    // A second mount of the card gets the same.
    expect(await awaitDeferredPlayer(pending?.pending ?? "")).toEqual(outcome);
  });

  it("tells the LLM of a missing NEUTRINO before rendering, however short the wait", async () => {
    const unsingable = { ...score, tracks: [{ instrument: "organ", sing: { engine: "neutrino" }, notes: [{ at: 1, pitch: "C4", lyric: "か" }] }] };
    const before = process.env.NEUTRINO_DIR;
    process.env.NEUTRINO_DIR = "/nonexistent/NEUTRINO";
    try {
      const result = await manage({ action: "renderScore", score: unsingable }, { player: true, deferAudio: { waitMs: 0 } });
      expect(result).toMatchObject({ isError: true, text: expect.stringContaining("NEUTRINO was not found") });
      expect(result.player).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.NEUTRINO_DIR;
      else process.env.NEUTRINO_DIR = before;
    }
  });

  it("checkScore tells the LLM whether it can sing: a missing NEUTRINO is an error on the sung track", async () => {
    const sung = { ...score, tracks: [{ instrument: "organ", sing: { engine: "neutrino" }, notes: [{ at: 1, pitch: "C4", lyric: "か" }] }] };
    const before = process.env.NEUTRINO_DIR;
    process.env.NEUTRINO_DIR = "/nonexistent/NEUTRINO";
    try {
      const check = z
        .object({ ok: z.boolean(), errors: z.array(z.object({ path: z.string(), message: z.string() })) })
        .parse(JSON.parse((await manage({ action: "checkScore", score: sung })).text));
      expect(check.ok).toBe(false);
      expect(check.errors[0]).toMatchObject({ path: "tracks[0].sing", message: expect.stringContaining("NEUTRINO was not found") });
      expect(JSON.parse((await manage({ action: "checkScore", score })).text)).toMatchObject({ ok: true });
    } finally {
      if (before === undefined) delete process.env.NEUTRINO_DIR;
      else process.env.NEUTRINO_DIR = before;
    }
  });

  it("gives a view the reason a render failed after the answer, and says when an id is unknown", async () => {
    const id = deferRender(Promise.reject(new Error("ffmpeg crashed")));
    expect(await awaitDeferredPlayer(id)).toEqual({ kind: "failed", message: "ffmpeg crashed" });
    expect(await awaitDeferredPlayer("no-such-render")).toEqual({ kind: "gone" });
  });

  it("is ignored without a player or with an output folder", async () => {
    const result = await manage({ action: "renderScore", score }, { deferAudio: { waitMs: 0 } });
    expect(result.player).toBeUndefined();
    expect(JSON.parse(result.text)).toHaveProperty("loudness");
  });
});
