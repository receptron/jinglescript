// Rendering a score to files: the audio and its timing map side by side. Shared by the CLI and the
// MCP server.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { render, type RenderOptions, type RenderResult } from "./render.ts";
import type { Score } from "./score.ts";
import { encodeAudio, type AudioFormat } from "./encode.ts";
import { toWav, type WavBits } from "./wav.ts";

export interface RenderedFiles {
  audio: string;
  timing: string;
  result: RenderResult;
}

export interface FileOptions extends RenderOptions {
  /** wav (default), or mp3/ogg through ffmpeg. */
  format?: AudioFormat;
  /** WAV bit depth (default 24). */
  bits?: WavBits;
}

/** Renders `score` and writes `<dir>/<stem>.<format>` and `<dir>/<stem>.timing.json`. */
export async function renderToFiles(score: Score, dir: string, stem: string, options: FileOptions = {}): Promise<RenderedFiles> {
  const result = render(score, options);
  await mkdir(dir, { recursive: true });
  const format = options.format ?? "wav";
  const audio = join(dir, `${stem}.${format}`);
  const timing = join(dir, `${stem}.timing.json`);
  if (format === "wav") await writeFile(audio, toWav(result.audio, result.sampleRate, options.bits ?? 24));
  else await encodeAudio(result.audio, result.sampleRate, format, audio);
  await writeFile(timing, `${JSON.stringify(result.timing, null, 2)}\n`);
  return { audio, timing, result };
}
