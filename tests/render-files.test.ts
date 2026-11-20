import { describe, expect, it } from "vitest";
import { awaitDeferredPlayer } from "../src/deferred-renders.ts";
import { ffmpegAvailable } from "../src/encode.ts";
import { manage } from "../src/manage.ts";
import type { RenderFiles } from "../src/render-files.ts";
import { TimingSchema } from "../src/timing.ts";

const extension = (await ffmpegAvailable()) ? "mp3" : "wav";
const score = {
  format: "jinglescript/1",
  title: "Kept",
  tempo: 120,
  length: { seconds: 2 },
  tracks: [
    {
      instrument: "marimba",
      notes: [
        { at: 0, pitch: "E4", len: 1, lyric: "あ" },
        { at: 1, pitch: "G4", len: 1, lyric: "さ" },
      ],
    },
  ],
};

/** A carrier's files in memory, under work/. */
function memoryFiles(): { files: RenderFiles; stored: Map<string, string | Uint8Array> } {
  const stored = new Map<string, string | Uint8Array>();
  const files: RenderFiles = {
    pathOf: (name) => `work/${name}`,
    exists: (name) => Promise.resolve(stored.has(name)),
    write: (name, content) => {
      stored.set(name, content);
      return Promise.resolve();
    },
  };
  return { files, stored };
}

interface Summary {
  audioFile?: string;
  timingFile?: string;
  audio?: string;
  timing: Record<string, unknown>;
}
const summaryOf = (text: string): Summary => JSON.parse(text) as Summary;

describe("renderScore with renderFiles (a carrier that keeps renders as files)", () => {
  it("writes the audio the player embeds and the timing map, and tells the model their paths", async () => {
    const { files, stored } = memoryFiles();
    const result = await manage({ action: "renderScore", score }, { player: true, renderFiles: files });
    const summary = summaryOf(result.text);
    expect(summary).toMatchObject({ audioFile: `work/jingle.${extension}`, timingFile: "work/jingle.timing.json" });
    expect(summary.timing.omitted).toContain("in timingFile");
    expect([...stored.keys()].sort()).toEqual([`jingle.${extension}`, "jingle.timing.json"]);

    const audio = stored.get(`jingle.${extension}`);
    if (!(audio instanceof Uint8Array)) throw new Error("the audio is written as bytes");
    expect(result.player?.audio).toBe(`data:${result.player?.mimeType ?? ""};base64,${Buffer.from(audio).toString("base64")}`);

    const timing = TimingSchema.parse(JSON.parse(String(stored.get("jingle.timing.json"))));
    expect(timing).toEqual(result.player?.timing);
    expect(timing.lyrics?.[0]?.syllables.map((s) => s.text)).toEqual(["あ", "さ"]);
  });

  it("never takes an earlier render's names: the same stem again becomes -2, -3", async () => {
    const { files, stored } = memoryFiles();
    const paths: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++)
      paths.push(summaryOf((await manage({ action: "renderScore", score, fileName: "song" }, { renderFiles: files })).text).audioFile);
    expect(paths).toEqual([`work/song.${extension}`, `work/song-2.${extension}`, `work/song-3.${extension}`]);
    expect(stored.size).toBe(6);
    // A stem whose audio is there in the other format, or whose timing map alone is there, is taken too.
    stored.set(`other.${extension === "mp3" ? "wav" : "mp3"}`, "");
    stored.set("other-2.timing.json", "");
    expect(summaryOf((await manage({ action: "renderScore", score, fileName: "other" }, { renderFiles: files })).text).timingFile).toBe(
      "work/other-3.timing.json",
    );
  });

  it("is named after the score file it was read from, and never like another score", async () => {
    const { files, stored } = memoryFiles();
    const options = { renderFiles: files, readScoreFile: () => Promise.resolve(JSON.stringify(score)) };
    stored.set("song.json", "the score that is rendered");
    stored.set("song-2.json", "another song");
    const paths: (string | undefined)[] = [];
    for (let i = 0; i < 2; i++) paths.push(summaryOf((await manage({ action: "renderScore", path: "work/song.json" }, options)).text).audioFile);
    // Its own score does not take the stem; the second render skips "song-2", which is another score's.
    expect(paths).toEqual([`work/song.${extension}`, `work/song-3.${extension}`]);
    // An inline score named like a score file that is there is not that file's render.
    expect(summaryOf((await manage({ action: "renderScore", score, fileName: "song-2" }, options)).text).audioFile).toBe(`work/song-2-2.${extension}`);
  });

  it("tells the model to give another name when none is left", async () => {
    const files: RenderFiles = { pathOf: (name) => name, exists: () => Promise.resolve(true), write: () => Promise.resolve() };
    const result = await manage({ action: "renderScore", score }, { renderFiles: files });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("Give another `fileName`") });
  });

  it("names the files of renders that run together apart, and of a render that answers before its audio", async () => {
    const { files, stored } = memoryFiles();
    const options = { player: true, deferAudio: { waitMs: 0 }, renderFiles: files } as const;
    const [first, second] = await Promise.all([manage({ action: "renderScore", score }, options), manage({ action: "renderScore", score }, options)]);
    const a = summaryOf(first.text);
    const b = summaryOf(second.text);
    expect([a.audioFile, b.audioFile].sort()).toEqual([`work/jingle-2.${extension}`, `work/jingle.${extension}`]);
    expect(a.audio).toContain("audioFile and timingFile are written then");
    expect(first.player?.pending).toEqual(expect.any(String));

    for (const result of [first, second]) {
      const outcome = await awaitDeferredPlayer(result.player?.pending ?? "");
      expect(outcome.kind).toBe("ready");
    }
    expect([...stored.keys()].sort()).toEqual([`jingle-2.${extension}`, "jingle-2.timing.json", `jingle.${extension}`, "jingle.timing.json"].sort());
  });

  it("keeps nothing and frees the name when the score is refused or the carrier writes to outDir", async () => {
    const { files, stored } = memoryFiles();
    const bad = await manage({ action: "renderScore", score: { ...score, tempo: -1 } }, { renderFiles: files });
    expect(bad.isError).toBe(true);
    expect(stored.size).toBe(0);
    expect(summaryOf((await manage({ action: "renderScore", score }, { renderFiles: files })).text).audioFile).toBe(`work/jingle.${extension}`);
    expect(summaryOf((await manage({ action: "renderScore", score })).text)).not.toHaveProperty("audioFile");
  });
});
