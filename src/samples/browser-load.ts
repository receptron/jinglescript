// Loading the recorded samples a score needs in a browser, where there is no package folder and no
// ~/.cache: the grand piano from VCSL through jsDelivr (the same bytes and SHA-256 as the Node
// loader), the recorded effects from a base URL (by default this version of the package on
// jsDelivr). Kept between visits in the browser's Cache API when the page has one.
import { samplesNeeded } from "../render.ts";
import type { Score } from "../score.ts";
import { SFX_FILES } from "../sounds/recorded-catalog.ts";
import { PACKAGE_VERSION } from "../version.ts";
import { fetchSample, matches, type SampleDownload } from "./fetch-sample.ts";
import { PIANO_SAMPLES } from "./piano-samples.ts";
import { loadInBatches, type SampleData, type SampleSource } from "./source.ts";
import { encodePath, PREFIX_SECONDS, VCSL_CDN_BASE_URL } from "./vcsl.ts";
import { decodeWavMono } from "./wav-read.ts";

export const DEFAULT_SFX_BASE_URL = `https://cdn.jsdelivr.net/npm/jinglescript@${PACKAGE_VERSION}/samples/sfx/`;
export const DEFAULT_CACHE_NAME = "jinglescript";

/** The part of the browser's Cache API the loader uses. */
export interface SampleCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}
export interface SampleCacheStorage {
  open(name: string): Promise<SampleCache>;
}

export interface BrowserLoadSamplesOptions {
  /** Folder URL (ending in "/") holding the recorded effects' WAVs. Default: DEFAULT_SFX_BASE_URL. */
  sfxBaseUrl?: string;
  /** Folder URL (ending in "/") of the VCSL repository at the pinned commit. Default: jsDelivr's mirror. */
  pianoBaseUrl?: string;
  /** Cache API name the checksummed samples (the piano's) are kept under, or false. Default: "jinglescript". */
  cache?: string | false;
  /** Replaces the page's `caches` (for tests, or a cache of your own). */
  caches?: SampleCacheStorage;
  /** Told about each download before it starts (bytes: undefined for a whole file). */
  onDownload?: (file: string, bytes: number | undefined) => void;
  /** The seed the score will be rendered with, when it overrides the score's. */
  seed?: number;
  /** Replaces the global fetch. */
  fetch?: typeof fetch;
}

/** One sample to load: where it comes from, what it must be, and how much of it is played. */
export interface BrowserSample extends SampleDownload {
  key: string;
  file: string;
  maxSeconds?: number;
}

const isCacheStorage = (value: unknown): value is SampleCacheStorage =>
  typeof value === "object" && value !== null && "open" in value && typeof value.open === "function";

/** The page's Cache API, when it has one: absent in Node, on plain-http pages and in some private modes. */
function pageCaches(): SampleCacheStorage | undefined {
  const value: unknown = Reflect.get(globalThis, "caches");
  return isCacheStorage(value) ? value : undefined;
}

async function openCache(options: BrowserLoadSamplesOptions): Promise<SampleCache | undefined> {
  if (options.cache === false) return undefined;
  try {
    return await (options.caches ?? pageCaches())?.open(options.cache ?? DEFAULT_CACHE_NAME);
  } catch {
    return undefined; // a cache that cannot be opened (storage blocked) only costs a download
  }
}

async function fromCache(cache: SampleCache | undefined, sample: BrowserSample): Promise<Uint8Array | undefined> {
  try {
    const response = await cache?.match(sample.url);
    if (response === undefined) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return (await matches(bytes, sample)) ? bytes : undefined;
  } catch {
    return undefined; // an unreadable entry is fetched again
  }
}

async function toCache(cache: SampleCache | undefined, sample: BrowserSample, bytes: Uint8Array): Promise<void> {
  try {
    await cache?.put(sample.url, new Response(new Uint8Array(bytes)));
  } catch {
    // Full or blocked storage: the sample is still loaded, just not kept for the next visit.
  }
}

async function loadOne(sample: BrowserSample, pageCache: SampleCache | undefined, options: BrowserLoadSamplesOptions): Promise<SampleData> {
  // Only a sample with a checksum is kept: a cached file without one could not be told from an older
  // version at the same URL, so those are left to the browser's HTTP cache.
  const cache = sample.sha256 === undefined ? undefined : pageCache;
  let bytes = await fromCache(cache, sample);
  if (bytes === undefined) {
    options.onDownload?.(sample.file, sample.bytes);
    bytes = await fetchSample(sample, options.fetch ?? fetch);
    await toCache(cache, sample, bytes);
  }
  return decodeWavMono(bytes, sample.maxSeconds);
}

/** Loads the given samples (from the cache, fetching what is missing) as a SampleSource. */
export async function loadBrowserSamples(samples: readonly BrowserSample[], options: BrowserLoadSamplesOptions = {}): Promise<SampleSource> {
  const cache = await openCache(options);
  return loadInBatches(samples, (sample) => loadOne(sample, cache, options));
}

/** Where the sample `key` comes from, or undefined for a key no loader knows. */
export function browserSample(key: string, options: BrowserLoadSamplesOptions = {}): BrowserSample | undefined {
  const piano = PIANO_SAMPLES.get(key);
  if (piano !== undefined) {
    const url = (options.pianoBaseUrl ?? VCSL_CDN_BASE_URL) + encodePath(piano.vcslPath);
    return { key, file: piano.file, url, bytes: piano.bytes, sha256: piano.sha256, maxSeconds: PREFIX_SECONDS };
  }
  const sfx = SFX_FILES.get(key);
  if (sfx !== undefined) return { key, file: sfx, url: (options.sfxBaseUrl ?? DEFAULT_SFX_BASE_URL) + sfx };
  return undefined;
}

/**
 * The recorded samples `score` plays (none when it uses no sampled instrument or recorded effect),
 * ready for `render(score, { samples })`, fetched over the network or read from the page's cache.
 */
export async function loadSamples(score: Score, options: BrowserLoadSamplesOptions = {}): Promise<SampleSource> {
  const samples = samplesNeeded(score, { seed: options.seed }).flatMap((key) => {
    const sample = browserSample(key, options);
    return sample === undefined ? [] : [sample];
  });
  return loadBrowserSamples(samples, options);
}
