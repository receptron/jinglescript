// The recordings that ship with the package (samples/sfx/, the recorded sound effects): read from
// the installed package, never downloaded. This module sits at the same depth in src/ and dist/, so
// the folder resolves the same from both.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allTakes, SFX_SET } from "../sounds/recorded-catalog.ts";
import { sampleKey, type SampleData, type SampleSource } from "./source.ts";
import { decodeWavMono } from "./wav-read.ts";

export const BUNDLED_SFX_DIR = fileURLToPath(new URL("../../samples/sfx/", import.meta.url));

/** Sample key → file in BUNDLED_SFX_DIR, for every bundled recording. */
const BUNDLED_FILES: ReadonlyMap<string, string> = new Map(allTakes().map((take) => [sampleKey(SFX_SET, take.file), `${take.file}.wav`]));

export function isBundledKey(key: string): boolean {
  return BUNDLED_FILES.has(key);
}

/** Reads the given bundled recordings (keys that are not bundled are skipped) as a SampleSource. */
export async function loadBundledSamples(keys: readonly string[], dir = BUNDLED_SFX_DIR): Promise<SampleSource> {
  const loaded = new Map<string, SampleData>();
  for (const key of keys) {
    const file = BUNDLED_FILES.get(key);
    if (file !== undefined) loaded.set(key, decodeWavMono(new Uint8Array(await readFile(join(dir, file)))));
  }
  return { get: (key) => loaded.get(key) };
}

/** Every bundled recording's key. */
export function bundledKeys(): string[] {
  return [...BUNDLED_FILES.keys()];
}
