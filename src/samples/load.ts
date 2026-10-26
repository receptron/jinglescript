// Loading the recorded samples a score needs, before it is rendered: from the cache, or downloaded
// into it on first use. Only the samples the score's notes actually play are fetched; each is
// checked against the SHA-256 in the catalog, so a render reads exactly the bytes it was tested on.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { samplesNeeded } from "../render.ts";
import type { Score } from "../score.ts";
import { isBundledKey, loadBundledSamples } from "./bundled.ts";
import { fetchSample, matches, SampleDownloadError } from "./fetch-sample.ts";
import { PIANO_SAMPLES } from "./piano-samples.ts";
import { loadInBatches, sampleSourceOf, type SampleData, type SampleSource } from "./source.ts";
import { PIANO_SET, PREFIX_SECONDS, vcslUrl, type CatalogEntry } from "./vcsl.ts";
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

/** A sample that can be downloaded: its key, where it comes from, and what it must hash to. */
export interface RemoteSample extends CatalogEntry {
  key: string;
  /** Cache path relative to the cache folder. */
  path: string;
  url: string;
}

const PIANO_REMOTE: ReadonlyMap<string, RemoteSample> = new Map(
  [...PIANO_SAMPLES].map(([key, { vcslPath, ...sample }]): [string, RemoteSample] => [
    key,
    { ...sample, path: join(PIANO_SET, sample.file), url: vcslUrl(vcslPath) },
  ]),
);

export function defaultCacheDir(): string {
  const env = process.env;
  if (env.JINGLESCRIPT_CACHE) return env.JINGLESCRIPT_CACHE;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "jinglescript");
}

async function cached(file: string, sample: RemoteSample): Promise<Uint8Array | undefined> {
  try {
    const bytes = new Uint8Array(await readFile(file));
    return (await matches(bytes, { url: sample.url, sha256: sample.sha256 })) ? bytes : undefined;
  } catch {
    return undefined;
  }
}

async function download(sample: RemoteSample, file: string, options: LoadSamplesOptions): Promise<Uint8Array> {
  options.onDownload?.(sample.file, sample.bytes);
  // Only the first seconds are used: fetchSample asks for those bytes.
  const bytes = await fetchSample(sample, options.fetch ?? fetch);
  // Written under a temporary name of its own and renamed: a cut-off download never looks like a
  // cached sample, and two renders fetching the same sample at once do not share a temporary file.
  const partial = `${file}.${randomUUID()}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, file);
  return bytes;
}

async function loadOne(sample: RemoteSample, cacheDir: string, options: LoadSamplesOptions): Promise<SampleData> {
  const file = join(cacheDir, sample.path);
  let bytes = await cached(file, sample);
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
  return loadInBatches(samples, (sample) => loadOne(sample, cacheDir, options));
}

/**
 * The recorded samples `score` plays (none when it uses no sampled instrument), ready for
 * `render(score, { samples })`. The recorded sound effects are read from the package; the grand
 * piano's samples are downloaded when they are not cached yet.
 */
export async function loadSamples(score: Score, options: LoadSamplesOptions = {}): Promise<SampleSource> {
  const keys = samplesNeeded(score, { seed: options.seed });
  const samples = keys.flatMap((key) => {
    const sample = PIANO_REMOTE.get(key);
    return sample === undefined ? [] : [sample];
  });
  const remote = await loadRemoteSamples(samples, options);
  const bundled = await loadBundledSamples(keys.filter(isBundledKey));
  const loaded = new Map<string, SampleData>();
  for (const key of keys) {
    const data = bundled.get(key) ?? remote.get(key);
    if (data !== undefined) loaded.set(key, data);
  }
  return sampleSourceOf(loaded);
}
