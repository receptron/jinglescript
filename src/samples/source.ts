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

/** No samples at all: what render() uses when it is given none. */
export const NO_SAMPLES: SampleSource = { get: () => undefined };

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
