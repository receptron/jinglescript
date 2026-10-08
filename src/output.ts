// Rendering a score to files: the audio and its timing map side by side. Shared by the CLI and the
// MCP server.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { render, type RenderOptions, type RenderResult } from "./render.ts";
import type { Score } from "./score.ts";
import { toWav, type WavBits } from "./wav.ts";

export interface RenderedFiles {
  audio: string;
  timing: string;
  result: RenderResult;
}

/** Renders `score` and writes `<dir>/<stem>.wav` and `<dir>/<stem>.timing.json`. */
export async function renderToFiles(score: Score, dir: string, stem: string, options: RenderOptions & { bits?: WavBits } = {}): Promise<RenderedFiles> {
  const result = render(score, options);
  await mkdir(dir, { recursive: true });
  const audio = join(dir, `${stem}.wav`);
  const timing = join(dir, `${stem}.timing.json`);
  await writeFile(audio, toWav(result.audio, result.sampleRate, options.bits ?? 24));
  await writeFile(timing, `${JSON.stringify(result.timing, null, 2)}\n`);
  return { audio, timing, result };
}
