// Opt-in singing: a track of a score sung by an installed singer model instead of played by its
// instrument. Async (ONNX Runtime), so it pre-renders the track and hands the PCM to render()
// through `prerendered`. Nothing here runs unless a caller asks for a singer.
import { join } from "node:path";
import * as dmath from "../dsp/math.ts";
import { pitchToMidi } from "../pitch.ts";
import { expandOrThrow, render, type RenderOptions, type RenderResult } from "../render.ts";
import { streamRng } from "../rng.ts";
import type { Score } from "../score.ts";
import { notesToFrames } from "./frames.ts";
import { loadOnnxRuntime, readSingerManifest, singerFolder, type OnnxRuntime, type SingerManifest } from "./model.ts";
import type { SingerFrames, SingerNote } from "./types.ts";
import { vocalChain, type VocalChainOptions, type VocalChainStats } from "./post.ts";
import { synthesizeEnvelope } from "./vocoder.ts";

export interface SingOptions {
  /** Index of the track to sing (its notes' `lyric`s are the words). */
  track: number;
  /** Installed model folder name under <cache>/singer/. */
  model: string;
  cacheDir?: string;
  /** Replaces the onnxruntime-node import (tests). */
  loadRuntime?: () => Promise<unknown>;
  /** The optional vocal chain (post.ts): true for its defaults. Off unless asked for. */
  post?: boolean | VocalChainOptions;
}

/** The sung notes of one track: onset to onset + hold, first pitch, the lyric ("" when none). */
export function singerNotes(score: Score, track: number): SingerNote[] {
  const notes: SingerNote[] = [];
  for (const event of expandOrThrow(score).events) {
    if (event.track !== track || event.repeat !== 0) continue;
    const midi = pitchToMidi(event.pitches[0] ?? "");
    if (midi === undefined) continue;
    const end = event.seconds + (Number.isFinite(event.hold) ? event.hold : 0.5);
    notes.push({ start: event.seconds, end, midi: midi + event.detune / 100, lyric: event.lyric ?? "" });
  }
  return notes.sort((a, b) => a.start - b.start);
}

/** Model input, frame-major: phoneme one-hot, log2(F0/440), voiced, position within the phoneme. */
export function singerFeatures(frames: SingerFrames, phonemes: readonly string[]): Float32Array {
  const width = phonemes.length + 3;
  const out = new Float32Array(frames.f0.length * width);
  for (const span of frames.phonemes) {
    const index = phonemes.indexOf(span.phoneme);
    for (let f = span.start; f < span.end && f < frames.f0.length; f++) {
      const row = f * width;
      if (index >= 0) out[row + index] = 1;
      const hz = frames.f0[f] ?? 0;
      if (hz > 0) {
        out[row + width - 3] = dmath.log2(hz / 440);
        out[row + width - 2] = 1;
      }
      out[row + width - 1] = (f - span.start) / Math.max(1, span.end - span.start - 1);
    }
  }
  return out;
}

interface Session {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
}

function isSession(value: unknown): value is Session {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "run") === "function";
}

async function acousticEnvelope(runtime: OnnxRuntime, manifest: SingerManifest, folder: string, features: Float32Array, count: number): Promise<Float32Array> {
  const session = await runtime.InferenceSession.create(join(folder, manifest.files.acoustic));
  if (!isSession(session)) throw new Error("onnxruntime-node returned no session");
  const width = manifest.phonemes.length + 3;
  const result = await session.run({ features: new runtime.Tensor("float32", features, [count, width]) });
  const data = result.envelope?.data;
  if (!(data instanceof Float32Array) || data.length !== count * manifest.melBins)
    throw new Error(`${manifest.name}: acoustic model gave no envelope of ${count}×${manifest.melBins}`);
  return data;
}

/** Mono PCM of the track sung by the model, at the model's sample rate, from time 0. */
export async function singTrack(
  score: Score,
  options: SingOptions,
  seed = score.seed,
): Promise<{ pcm: Float32Array; sampleRate: number; post?: VocalChainStats }> {
  const manifest = await readSingerManifest(options.model, options.cacheDir);
  if (manifest.files.vocoder !== undefined || manifest.envelope === undefined)
    throw new Error(`${manifest.name}: only envelope models with the built-in vocoder are supported yet`);
  const runtime = await loadOnnxRuntime(options.loadRuntime);
  const frames = notesToFrames(singerNotes(score, options.track), { hop: manifest.hopSize / manifest.sampleRate });
  const count = frames.f0.length;
  const pcm = new Float32Array(count * manifest.hopSize);
  if (count === 0) return { pcm, sampleRate: manifest.sampleRate };
  const folder = singerFolder(options.model, options.cacheDir);
  const env = await acousticEnvelope(runtime, manifest, folder, singerFeatures(frames, manifest.phonemes), count);
  const format = { sampleRate: manifest.sampleRate, hopSize: manifest.hopSize, bands: manifest.melBins, ...manifest.envelope };
  const sung = synthesizeEnvelope(env, frames.f0, format, streamRng(seed, "singer", options.track));
  if (options.post === undefined || options.post === false) return { pcm: sung, sampleRate: manifest.sampleRate };
  const voicing = { voiced: Uint8Array.from(frames.f0, (hz) => (hz > 0 ? 1 : 0)), hop: manifest.hopSize };
  const chain = vocalChain(sung, manifest.sampleRate, { voicing, ...(options.post === true ? {} : options.post) });
  return { pcm: chain.pcm, sampleRate: manifest.sampleRate, post: chain.stats };
}

/** render(), with one track sung by a singer model. The model's sample rate must be the render's. */
export async function renderWithSinger(score: Score, sing: SingOptions, options: RenderOptions = {}): Promise<RenderResult> {
  const { pcm, sampleRate } = await singTrack(score, sing, options.seed ?? score.seed);
  if (sampleRate !== (options.sampleRate ?? 44100)) throw new Error(`The singer renders at ${sampleRate} Hz; render at that rate.`);
  return render(score, { ...options, prerendered: new Map([[sing.track, pcm]]) });
}
