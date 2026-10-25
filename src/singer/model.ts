// Finding and loading the singing-voice models. Nothing is bundled: a model is a folder in the
// sample cache (singer/<name>/) with a manifest.json and ONNX files, downloaded on first use the
// way the grand piano is. ONNX Runtime is an optional dependency, imported only here and only when a
// singer is rendered, so a score without a singer never needs it.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultCacheDir } from "../samples/load.ts";

/** Licences a published singer model may carry: ones under which anyone may use the output freely. */
export const SINGER_MODEL_LICENSES = ["MIT", "CC0-1.0", "CC-BY-4.0"] as const;

export const SingerManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string(),
  license: z.enum(SINGER_MODEL_LICENSES),
  /** Who must be credited (CC-BY), and the training data, for the model card. */
  credit: z.string().optional(),
  sampleRate: z.number().int().positive(),
  hopSize: z.number().int().positive(),
  melBins: z.number().int().positive(),
  phonemes: z.array(z.string()).min(1),
  files: z.object({ acoustic: z.string(), vocoder: z.string(), pitch: z.string().optional() }),
  sha256: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
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

/** The part of onnxruntime-node the singer uses. */
export interface OnnxRuntime {
  InferenceSession: { create(path: string): Promise<unknown> };
}

function isOnnxRuntime(value: unknown): value is OnnxRuntime {
  if (typeof value !== "object" || value === null) return false;
  const session: unknown = Reflect.get(value, "InferenceSession");
  return typeof session === "function" || (typeof session === "object" && session !== null && typeof Reflect.get(session, "create") === "function");
}

let runtime: Promise<OnnxRuntime> | undefined;

/** Imports onnxruntime-node once, on first use. `load` replaces the import (tests). */
export function loadOnnxRuntime(load: () => Promise<unknown> = () => import(ONNX_MODULE)): Promise<OnnxRuntime> {
  runtime ??= load().then(
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
  runtime.catch(() => {
    runtime = undefined; // a failed import can be retried after installing it
  });
  return runtime;
}

// A variable, so TypeScript and bundlers do not try to resolve the optional package.
const ONNX_MODULE: string = "onnxruntime-node";
