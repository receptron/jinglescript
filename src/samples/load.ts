// Loading the recorded samples a score needs, before it is rendered: from the cache, or downloaded
// into it on first use. Only the samples the score's notes actually play are fetched; each is
// checked against the SHA-256 in the catalog, so a render reads exactly the bytes it was tested on.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { samplesNeeded } from "../render.ts";
import type { Score } from "../score.ts";
import { PIANO_CATALOG } from "./piano-catalog.ts";
import { sampleKey, type SampleData, type SampleSource } from "./source.ts";
import { PIANO_DIR, PIANO_SET, pianoFile, PREFIX_SECONDS, vcslUrl, type CatalogEntry } from "./vcsl.ts";
import { decodeWavMono } from "./wav-read.ts";

export interface LoadSamplesOptions {
  /** Where samples are kept. Default: $JINGLESCRIPT_CACHE, else $XDG_CACHE_HOME/jinglescript, else ~/.cache/jinglescript. */
  cacheDir?: string;
  /** false: use the cache only and fail on a missing sample, never touching the network. Default true. */
  download?: boolean;
  /** Told about each download before it starts (for a progress line). */
  onDownload?: (file: string, bytes: number) => void;
  /** The seed the score will be rendered with, when it overrides the score's. */
  seed?: number;
  /** For tests: replaces the global fetch. */
  fetch?: typeof fetch;
}

/** A sample could not be fetched or did not match its checksum. */
export class SampleDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleDownloadError";
  }
}

/** A sample that can be downloaded: its key, where it comes from, and what it must hash to. */
export interface RemoteSample extends CatalogEntry {
  key: string;
  /** Cache path relative to the cache folder. */
  path: string;
  url: string;
}

const PARALLEL_DOWNLOADS = 6;

const PIANO_SAMPLES: ReadonlyMap<string, RemoteSample> = new Map(
  PIANO_CATALOG.map(([pitch, layer, bytes, sha256, cents]): [string, RemoteSample] => {
    const file = pianoFile(pitch, layer);
    const key = sampleKey(PIANO_SET, file);
    return [key, { pitch, layer, file, bytes, sha256, cents, key, path: join(PIANO_SET, file), url: vcslUrl(`${PIANO_DIR}/${file}`) }];
  }),
);

export function defaultCacheDir(): string {
  const env = process.env;
  if (env.JINGLESCRIPT_CACHE) return env.JINGLESCRIPT_CACHE;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "jinglescript");
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function cached(file: string, expected: string): Promise<Uint8Array | undefined> {
  try {
    const bytes = new Uint8Array(await readFile(file));
    return sha256(bytes) === expected ? bytes : undefined;
  } catch {
    return undefined;
  }
}

async function download(sample: RemoteSample, file: string, options: LoadSamplesOptions): Promise<Uint8Array> {
  options.onDownload?.(sample.file, sample.bytes);
  const get = options.fetch ?? fetch;
  let response: Response;
  try {
    // Only the first seconds are used: ask for those bytes (a server that ignores Range sends all).
    response = await get(sample.url, { headers: { Range: `bytes=0-${sample.bytes - 1}` } });
  } catch (error) {
    throw new SampleDownloadError(`Could not download ${sample.url}: ${error instanceof Error ? error.message : String(error)}. Check the network connection.`);
  }
  if (!response.ok) throw new SampleDownloadError(`Could not download ${sample.url}: HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, sample.bytes);
  if (bytes.length !== sample.bytes || sha256(bytes) !== sample.sha256) {
    throw new SampleDownloadError(`${sample.url} did not match its checksum (got ${bytes.length} of ${sample.bytes} bytes); nothing was cached. Try again.`);
  }
  // Written under a temporary name and renamed: a cut-off download never looks like a cached sample.
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, file);
  return bytes;
}

async function loadOne(sample: RemoteSample, cacheDir: string, options: LoadSamplesOptions): Promise<SampleData> {
  const file = join(cacheDir, sample.path);
  let bytes = await cached(file, sample.sha256);
  if (bytes === undefined) {
    if (options.download === false) throw new SampleDownloadError(`${sample.file} is not in the sample cache (${cacheDir}), and downloading is off.`);
    await mkdir(join(file, ".."), { recursive: true });
    bytes = await download(sample, file, options);
  }
  return decodeWavMono(bytes, PREFIX_SECONDS);
}

/** Loads the given samples (from the cache, downloading what is missing) as a SampleSource. */
export async function loadRemoteSamples(samples: readonly RemoteSample[], options: LoadSamplesOptions = {}): Promise<SampleSource> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const loaded = new Map<string, SampleData>();
  for (let i = 0; i < samples.length; i += PARALLEL_DOWNLOADS) {
    const batch = samples.slice(i, i + PARALLEL_DOWNLOADS);
    const data = await Promise.all(batch.map((sample) => loadOne(sample, cacheDir, options)));
    batch.forEach((sample, k) => {
      const d = data[k];
      if (d !== undefined) loaded.set(sample.key, d);
    });
  }
  return { get: (key) => loaded.get(key) };
}

/**
 * The recorded samples `score` plays (none when it uses no sampled instrument), ready for
 * `render(score, { samples })`. Downloads what is not cached yet.
 */
export async function loadSamples(score: Score, options: LoadSamplesOptions = {}): Promise<SampleSource> {
  const keys = samplesNeeded(score, { seed: options.seed });
  const samples = keys.flatMap((key) => {
    const sample = PIANO_SAMPLES.get(key);
    return sample === undefined ? [] : [sample];
  });
  return loadRemoteSamples(samples, options);
}
