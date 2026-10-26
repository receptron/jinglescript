// The recordings that ship with the package (samples/sfx/, the recorded sound effects): read from
// the installed package, never downloaded. This module sits at the same depth in src/ and dist/, so
// the folder resolves the same from both.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SFX_FILES } from "../sounds/recorded-catalog.ts";
import { sampleSourceOf, type SampleData, type SampleSource } from "./source.ts";
import { decodeWavMono } from "./wav-read.ts";

export const BUNDLED_SFX_DIR = fileURLToPath(new URL("../../samples/sfx/", import.meta.url));

export function isBundledKey(key: string): boolean {
  return SFX_FILES.has(key);
}

/** Reads the given bundled recordings (keys that are not bundled are skipped) as a SampleSource. */
export async function loadBundledSamples(keys: readonly string[], dir = BUNDLED_SFX_DIR): Promise<SampleSource> {
  const loaded = new Map<string, SampleData>();
  for (const key of keys) {
    const file = SFX_FILES.get(key);
    if (file !== undefined) loaded.set(key, decodeWavMono(new Uint8Array(await readFile(join(dir, file)))));
  }
  return sampleSourceOf(loaded);
}

/** Every bundled recording's key. */
export function bundledKeys(): string[] {
  return [...SFX_FILES.keys()];
}
