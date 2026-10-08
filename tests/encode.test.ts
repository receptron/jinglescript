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
