// The recorded samples a render may use. Rendering never downloads: loadSamples() (src/samples/load.ts)
// fetches and decodes what a score needs first, and render() is handed the result.

export interface SampleData {
  sampleRate: number;
  /** Mono. */
  data: Float32Array;
}

export interface SampleSource {
  /** A sample by key (`<set>/<file>`), or undefined when it was not loaded. */
  get(key: string): SampleData | undefined;
}

export function sampleKey(set: string, file: string): string {
  return `${set}/${file}`;
}

const PARALLEL_LOADS = 6;

/** Every sample a source loaded, for sources this module built: what a render on a worker thread is sent. */
const LOADED = new WeakMap<SampleSource, ReadonlyMap<string, SampleData>>();

/** A SampleSource over `samples`, which loadedSamples() can list. */
export function sampleSourceOf(samples: ReadonlyMap<string, SampleData>): SampleSource {
  const source: SampleSource = { get: (key) => samples.get(key) };
  LOADED.set(source, samples);
  return source;
}

/** All the samples in `source` when it was built by sampleSourceOf(), else undefined (a source of the caller's own). */
export function loadedSamples(source: SampleSource): ReadonlyMap<string, SampleData> | undefined {
  return LOADED.get(source);
}

/** Loads each sample, a few at a time, into a SampleSource keyed by `sample.key`. */
export async function loadInBatches<T extends { key: string }>(samples: readonly T[], load: (sample: T) => Promise<SampleData>): Promise<SampleSource> {
  const loaded = new Map<string, SampleData>();
  for (let i = 0; i < samples.length; i += PARALLEL_LOADS) {
    const batch = samples.slice(i, i + PARALLEL_LOADS);
    const data = await Promise.all(batch.map(load));
    batch.forEach((sample, k) => {
      const d = data[k];
      if (d !== undefined) loaded.set(sample.key, d);
    });
  }
  return sampleSourceOf(loaded);
}

/** No samples at all: what render() uses when it is given none. */
export const NO_SAMPLES: SampleSource = sampleSourceOf(new Map());

/** A sampled instrument was played without its samples loaded. */
export class SamplesNotLoadedError extends Error {
  readonly key: string;
  constructor(instrument: string, key: string) {
    super(
      `"${instrument}" plays recorded samples, and ${key} was not loaded. Load them before rendering: ` +
        "`render(score, { samples: await loadSamples(score) })`, or use renderToFiles(), the CLI or the MCP tool, which do it for you.",
    );
    this.name = "SamplesNotLoadedError";
    this.key = key;
  }
}

/** Records the keys asked for and answers with silence: how loadSamples() finds what a score needs. */
export function recordingSource(): SampleSource & { keys: Set<string> } {
  const keys = new Set<string>();
  const silence: SampleData = { sampleRate: 44100, data: new Float32Array(1) };
  return {
    keys,
    get(key) {
      keys.add(key);
      return silence;
    },
  };
}
