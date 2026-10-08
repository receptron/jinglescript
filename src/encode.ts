// MP3 and OGG through ffmpeg, which is optional: WAV needs nothing, and ffmpeg is looked for only
// when a compressed format is asked for. The PCM handed to ffmpeg is the deterministic render;
// the encoder's own output may differ between ffmpeg builds.
import { spawn } from "node:child_process";
import { toWav } from "./wav.ts";

export const AUDIO_FORMATS = ["wav", "mp3", "ogg"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

const CODEC: Record<Exclude<AudioFormat, "wav">, string[]> = {
  // VBR around 190 kbit/s: transparent for jingles, small enough for the web.
  mp3: ["-c:a", "libmp3lame", "-q:a", "2"],
  ogg: ["-c:a", "libvorbis", "-q:a", "6"],
};

export class FfmpegMissingError extends Error {
  constructor(format: AudioFormat) {
    super(`${format.toUpperCase()} needs ffmpeg on the PATH (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg). WAV works without it.`);
    this.name = "FfmpegMissingError";
  }
}

export function isAudioFormat(name: string): name is AudioFormat {
  return AUDIO_FORMATS.some((f) => f === name);
}

function run(args: string[], input?: Uint8Array): Promise<{ code: number | null; stderr: string; missing: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => resolve({ code: null, stderr: error.message, missing: error.code === "ENOENT" }));
    child.on("close", (code) => resolve({ code, stderr, missing: false }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** Whether ffmpeg can be run (for tests that skip without it). */
export async function ffmpegAvailable(): Promise<boolean> {
  const result = await run(["-hide_banner", "-version"]);
  return result.code === 0;
}

/** Writes stereo audio to `path` as MP3 or OGG via ffmpeg. */
export async function encodeAudio(audio: readonly Float32Array[], sampleRate: number, format: Exclude<AudioFormat, "wav">, path: string): Promise<void> {
  const result = await run(["-hide_banner", "-loglevel", "error", "-y", "-f", "wav", "-i", "pipe:0", ...CODEC[format], path], toWav(audio, sampleRate, 24));
  if (result.missing) throw new FfmpegMissingError(format);
  if (result.code !== 0) throw new Error(`ffmpeg could not write ${path}: ${result.stderr.trim()}`);
}
