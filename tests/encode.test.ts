import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../src/encode.ts";
import { parseScore } from "../src/index.ts";
import { renderToFiles } from "../src/output.ts";

// MP3/OGG need ffmpeg; without it these tests skip (CLAUDE.md: never fail for it).
const hasFfmpeg = await ffmpegAvailable();
const exampleA = parseScore(JSON.parse(readFileSync(new URL("../examples/hatena-marumo-a.json", import.meta.url), "utf8")));
const dir = mkdtempSync(join(tmpdir(), "jinglescript-encode-"));

const probe = (file: string) =>
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate:format=duration", "-of", "json", file], {
    encoding: "utf8",
  });

describe.runIf(hasFfmpeg)("MP3 and OGG through ffmpeg", () => {
  for (const [format, codec] of [
    ["mp3", "mp3"],
    ["ogg", "vorbis"],
  ] as const) {
    it(`writes ${format}: stereo ${codec} at 48 kHz, the score's length`, async () => {
      const files = await renderToFiles(exampleA, dir, `a-${format}`, { format });
      expect(files.audio).toBe(join(dir, `a-${format}.${format}`));
      const info = JSON.parse(probe(files.audio)) as { streams: { codec_name: string; channels: number; sample_rate: string }[]; format: { duration: string } };
      expect(info.streams[0]).toMatchObject({ codec_name: codec, channels: 2, sample_rate: "48000" });
      // MP3 frames add a little padding.
      expect(Math.abs(Number(info.format.duration) - 4.6)).toBeLessThan(0.1);
      expect(JSON.parse(readFileSync(files.timing, "utf8"))).toMatchObject({ cues: { hit: 1.5 } });
    });
  }
});

const tagged = parseScore({
  format: "jinglescript/1",
  title: "Tag test",
  author: "Jingle Co.",
  copyright: "© 2026 Jingle Co.",
  tempo: 120,
  length: { seconds: 1 },
  tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C5" }] }],
});

describe.runIf(hasFfmpeg)("title, author and copyright in MP3 and OGG", () => {
  for (const format of ["mp3", "ogg"] as const) {
    it(`writes title, artist and copyright to ${format}`, async () => {
      const files = await renderToFiles(tagged, dir, `tagged-${format}`, { format });
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", files.audio], { encoding: "utf8" });
      const info = JSON.parse(probe) as { format?: { tags?: Record<string, string> }; streams?: { tags?: Record<string, string> }[] };
      const tags = Object.fromEntries(Object.entries({ ...info.format?.tags, ...info.streams?.[0]?.tags }).map(([key, value]) => [key.toLowerCase(), value]));
      expect(tags).toMatchObject({ title: "Tag test", artist: "Jingle Co.", copyright: "© 2026 Jingle Co." });
    });
  }
});
