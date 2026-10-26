// Finding and loading the singing-voice models. Nothing is bundled: a model is a folder in the
// sample cache (singer/<name>/) with a manifest.json and ONNX files, downloaded on first use the
// way the grand piano is. ONNX Runtime is an optional dependency, imported only here and only when a
// singer is rendered, so a score without a singer never needs it.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultCacheDir } from "../samples/load.ts";

/** Licences a published singer model may carry: ones under which anyone may use the output freely. */
export const SINGER_MODEL_LICENSES = ["MIT", "CC0-1.0", "CC-BY-4.0"] as const;

export const SingerManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string(),
    license: z.enum(SINGER_MODEL_LICENSES),
    /** Who must be credited (CC-BY), and the training data, for the model card. */
    credit: z.string().optional(),
    sampleRate: z.number().int().positive(),
    hopSize: z.number().int().positive(),
    melBins: z.number().int().positive(),
    phonemes: z.array(z.string()).min(1),
    /** How the acoustic model's frames are to be read when there is no neural vocoder (built-in DSP vocoder). */
    envelope: z
      .object({
        kind: z.literal("band-log-power"),
        fftSize: z
          .number()
          .int()
          .positive()
          .refine((n) => (n & (n - 1)) === 0, "fftSize must be a power of two (256, 512, 1024, …): the FFT in src/dsp/fft.ts needs one"),
        maxHz: z.number().positive(),
      })
      .optional(),
    /** No `vocoder` file: the built-in harmonic + noise vocoder (src/singer/vocoder.ts) reads `envelope` frames. */
    files: z.object({ acoustic: z.string(), vocoder: z.string().optional(), pitch: z.string().optional() }),
    sha256: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.envelope !== undefined && manifest.envelope.fftSize < manifest.hopSize)
      ctx.addIssue({
        code: "custom",
        path: ["envelope", "fftSize"],
        message: `fftSize (${manifest.envelope.fftSize}) must be at least hopSize (${manifest.hopSize})`,
      });
    for (const file of Object.values(manifest.files))
      if (typeof file === "string" && !(file in manifest.sha256)) ctx.addIssue({ code: "custom", path: ["sha256"], message: `no sha256 for "${file}"` });
  });
export type SingerManifest = z.infer<typeof SingerManifestSchema>;

export class SingerModelMissingError extends Error {
  readonly model: string;
  readonly folder: string;
  constructor(model: string, folder: string, reason: string) {
    super(
      `The singer model "${model}" is not installed (${reason}). It is not part of jinglescript; put its manifest.json and ONNX files in ${folder} (see docs/singing-voice-plan.md), or remove the singer track.`,
    );
    this.name = "SingerModelMissingError";
    this.model = model;
    this.folder = folder;
  }
}

export class SingerRuntimeMissingError extends Error {
  constructor() {
    super('Singing needs ONNX Runtime, which is optional: run "yarn add onnxruntime-node" (or npm install onnxruntime-node) next to jinglescript.');
    this.name = "SingerRuntimeMissingError";
  }
}

export function singerFolder(model: string, cacheDir = defaultCacheDir()): string {
  return join(cacheDir, "singer", model);
}

/** Reads and validates a model's manifest; a missing or invalid one is a SingerModelMissingError. */
export async function readSingerManifest(model: string, cacheDir?: string): Promise<SingerManifest> {
  const folder = singerFolder(model, cacheDir);
  let text: string;
  try {
    text = await readFile(join(folder, "manifest.json"), "utf8");
  } catch {
    throw new SingerModelMissingError(model, folder, "no manifest.json");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SingerModelMissingError(model, folder, "manifest.json is not JSON");
  }
  const parsed = SingerManifestSchema.safeParse(json);
  if (!parsed.success)
    throw new SingerModelMissingError(
      model,
      folder,
      "manifest.json: " + parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; "),
    );
  if (parsed.data.name !== model) throw new SingerModelMissingError(model, folder, `manifest.json names "${parsed.data.name}"`);
  return parsed.data;
}

export class SingerModelCorruptError extends Error {
  readonly file: string;
  constructor(model: string, file: string, expected: string, actual: string) {
    super(
      `The singer model "${model}" is damaged or a different version: ${file} has sha256 ${actual}, but its manifest.json expects ${expected}. Download the model again (delete the folder and re-fetch it).`,
    );
    this.name = "SingerModelCorruptError";
    this.file = file;
  }
}

/** Checks one of the model's files against manifest.sha256 and returns its path; a SingerModelMissingError or SingerModelCorruptError otherwise. */
/** Files verified in this process, keyed by path, size and mtime, so a big model is hashed once. */
const verified = new Set<string>();

export async function verifiedModelFile(manifest: SingerManifest, file: string, cacheDir?: string): Promise<string> {
  const folder = singerFolder(manifest.name, cacheDir);
  const path = join(folder, file);
  const expected = manifest.sha256[file];
  if (expected === undefined) throw new SingerModelMissingError(manifest.name, folder, `manifest.json has no sha256 for ${file}`);
  let key: string;
  let bytes: Buffer;
  try {
    const info = await stat(path);
    key = `${path}\0${info.size}\0${info.mtimeMs}\0${expected}`;
    if (verified.has(key)) return path;
    bytes = await readFile(path);
  } catch {
    throw new SingerModelMissingError(manifest.name, folder, `no ${file}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new SingerModelCorruptError(manifest.name, file, expected, actual);
  verified.add(key);
  return path;
}

/** The part of onnxruntime-node the singer uses. */
export interface OnnxRuntime {
  InferenceSession: { create(path: string): Promise<unknown> };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
}

function isOnnxRuntime(value: unknown): value is OnnxRuntime {
  if (typeof value !== "object" || value === null) return false;
  const session: unknown = Reflect.get(value, "InferenceSession");
  return typeof session === "function" || (typeof session === "object" && session !== null && typeof Reflect.get(session, "create") === "function");
}

let defaultRuntime: Promise<OnnxRuntime> | undefined;

function asRuntime(load: () => Promise<unknown>): Promise<OnnxRuntime> {
  return load().then(
    (module) => {
      const candidate: unknown = typeof module === "object" && module !== null && "default" in module ? Reflect.get(module, "default") : module;
      if (isOnnxRuntime(candidate)) return candidate;
      if (isOnnxRuntime(module)) return module;
      throw new SingerRuntimeMissingError();
    },
    () => {
      throw new SingerRuntimeMissingError();
    },
  );
}

/**
 * Imports onnxruntime-node once, on first use. A given `load` replaces the import (tests) and is
 * called every time: only the default import is cached.
 */
export function loadOnnxRuntime(load?: () => Promise<unknown>): Promise<OnnxRuntime> {
  if (load !== undefined) return asRuntime(load);
  const pending = (defaultRuntime ??= asRuntime(() => import(ONNX_MODULE)));
  pending.catch(() => {
    if (defaultRuntime === pending) defaultRuntime = undefined; // a failed import can be retried after installing it
  });
  return pending;
}

// A variable, so TypeScript and bundlers do not try to resolve the optional package.
const ONNX_MODULE: string = "onnxruntime-node";
