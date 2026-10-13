import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSamples as loadInBrowser, DEFAULT_SFX_BASE_URL } from "../src/browser.ts";
import { defaultCacheDir, loadSamples as loadInNode, parseScore, render, samplesNeeded } from "../src/index.ts";
import { BUNDLED_SFX_DIR } from "../src/samples/bundled.ts";
import { browserSample, loadBrowserSamples, type BrowserSample, type SampleCache, type SampleCacheStorage } from "../src/samples/browser-load.ts";
import { SampleDownloadError } from "../src/samples/fetch-sample.ts";
import { PIANO_SET, VCSL_CDN_BASE_URL } from "../src/samples/vcsl.ts";
import { toWav } from "../src/wav.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const example = (name: string) => parseScore(JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8")));

/** An in-memory Cache API: what a page's `caches` does, for the calls the loader makes. */
function memoryCaches() {
  const entries = new Map<string, Uint8Array>();
  const opened: string[] = [];
  const cache: SampleCache = {
    match: async (url) => {
      const bytes = entries.get(url);
      return bytes === undefined ? undefined : new Response(new Uint8Array(bytes));
    },
    put: async (url, response) => {
      entries.set(url, new Uint8Array(await response.arrayBuffer()));
    },
  };
  const caches: SampleCacheStorage = {
    open: (name) => {
      opened.push(name);
      return Promise.resolve(cache);
    },
  };
  return { caches, entries, opened };
}

/** A server answering every URL with `body`, recording each request's URL and Range header. */
function serving(body: Uint8Array, status = 206) {
  const calls: { url: string; range: string | null }[] = [];
  const fetch: typeof globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), range: new Headers(init?.headers).get("Range") });
    return Promise.resolve(new Response(new Uint8Array(body), { status }));
  };
  return { calls, fetch };
}

/** A server answering from samples/sfx/ on disk, as jsDelivr serves the published package. */
const sfxFromDisk: typeof globalThis.fetch = (url) => {
  const file = String(url).split("/").pop() ?? "";
  return Promise.resolve(new Response(new Uint8Array(readFileSync(join(BUNDLED_SFX_DIR, file)))));
};

const sine = (rate: number, seconds: number) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
const wav = toWav([sine(44100, 0.2), sine(44100, 0.2)], 44100, 24);
const ranged: BrowserSample = {
  key: "test-set/test.wav",
  file: "test.wav",
  url: "https://example.invalid/test.wav",
  bytes: wav.length,
  sha256: createHash("sha256").update(wav).digest("hex"),
  maxSeconds: 0.1,
};

describe("browser loadSamples", () => {
  it("fetches the first bytes with a range, keeps the first seconds, caches them, then reads the cache", async () => {
    const { caches, entries, opened } = memoryCaches();
    const server = serving(new Uint8Array([...wav, ...new Uint8Array(1000)]), 200); // a server that ignores Range
    const source = await loadBrowserSamples([ranged], { caches, fetch: server.fetch });
    expect(server.calls).toEqual([{ url: ranged.url, range: `bytes=0-${wav.length - 1}` }]);
    expect(source.get(ranged.key)?.data).toHaveLength(Math.round(0.1 * 44100));
    expect(opened).toEqual(["jinglescript"]);
    expect(entries.get(ranged.url)).toHaveLength(wav.length);

    const offline = serving(new Uint8Array(), 500);
    const again = await loadBrowserSamples([ranged], { caches, fetch: offline.fetch });
    expect(offline.calls).toEqual([]);
    expect(again.get(ranged.key)?.data).toEqual(source.get(ranged.key)?.data);
  });

  it("refuses bytes that do not match the checksum, and caches nothing", async () => {
    const { caches, entries } = memoryCaches();
    const bad = Uint8Array.from(wav, (b, i) => (i === 100 ? b ^ 1 : b));
    await expect(loadBrowserSamples([ranged], { caches, fetch: serving(bad).fetch })).rejects.toThrow(SampleDownloadError);
    expect(entries.size).toBe(0);
  });

  it("fetches again over a cache entry that does not match", async () => {
    const { caches, entries } = memoryCaches();
    entries.set(ranged.url, wav.subarray(0, 100));
    const server = serving(wav);
    await loadBrowserSamples([ranged], { caches, fetch: server.fetch });
    expect(server.calls).toHaveLength(1);
    expect(entries.get(ranged.url)).toHaveLength(wav.length);
  });

  it("works with the cache off, with no Cache API, and with one that cannot be opened", async () => {
    const { caches, opened } = memoryCaches();
    await loadBrowserSamples([ranged], { cache: false, caches, fetch: serving(wav).fetch });
    expect(opened).toEqual([]);
    await loadBrowserSamples([ranged], { fetch: serving(wav).fetch }); // Node has no `caches`
    const broken: SampleCacheStorage = { open: () => Promise.reject(new Error("storage blocked")) };
    const source = await loadBrowserSamples([ranged], { caches: broken, fetch: serving(wav).fetch });
    expect(source.get(ranged.key)).toBeDefined();
  });

  it("reports HTTP and network errors with the URL", async () => {
    await expect(loadBrowserSamples([ranged], { cache: false, fetch: serving(new Uint8Array(), 404).fetch })).rejects.toThrow(/test\.wav: HTTP 404/);
    const offline: typeof globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(loadBrowserSamples([ranged], { cache: false, fetch: offline })).rejects.toThrow(
      /Could not download https:\/\/example\.invalid\/test\.wav: Failed to fetch/,
    );
  });

  it("loads nothing for a score without recordings", async () => {
    const fetch: typeof globalThis.fetch = () => Promise.reject(new Error("no network in tests"));
    const source = await loadInBrowser(example("hatena-marumo-a.json"), { fetch });
    expect(source.get("anything")).toBeUndefined();
  });
});

describe("where the browser loader fetches from", () => {
  it("the grand piano: VCSL through jsDelivr, its first bytes, checked", () => {
    const key = `${PIANO_SET}/JHPiano_NoSus_Close_C4_vl3_rr1.wav`;
    expect(browserSample(key)).toMatchObject({
      url: `${VCSL_CDN_BASE_URL}Chordophones/Zithers/Grand%20Piano%2C%20Steinway%20B/NoSus/JHPiano_NoSus_Close_C4_vl3_rr1.wav`,
      bytes: 1190746,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      maxSeconds: 4.5,
    });
    expect(browserSample(key, { pianoBaseUrl: "/vcsl/" })?.url).toMatch(/^\/vcsl\/Chordophones\//);
  });

  it("the recorded effects: this version of the package on jsDelivr, or a base URL, whole and unchecked", () => {
    expect(DEFAULT_SFX_BASE_URL).toBe(`https://cdn.jsdelivr.net/npm/jinglescript@${version}/samples/sfx/`);
    expect(browserSample("sfx/door-creak")).toEqual({ key: "sfx/door-creak", file: "door-creak.wav", url: `${DEFAULT_SFX_BASE_URL}door-creak.wav` });
    expect(browserSample("sfx/door-creak", { sfxBaseUrl: "./sfx/" })?.url).toBe("./sfx/door-creak.wav");
    expect(browserSample("no-such-set/file.wav")).toBeUndefined();
  });

  it("knows every sample a score can need", () => {
    const keys = samplesNeeded(example("recorded-effects.json"));
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => browserSample(key) === undefined)).toEqual([]);
  });
});

describe("browser and Node loaders give the same render", () => {
  it("for the recorded effects", async () => {
    const score = example("recorded-effects.json");
    const inBrowser = render(score, { samples: await loadInBrowser(score, { cache: false, fetch: sfxFromDisk }) }).audio;
    const inNode = render(score, { samples: await loadInNode(score, { download: false }) }).audio;
    expect(inBrowser[0]).toEqual(inNode[0]);
    expect(inBrowser[1]).toEqual(inNode[1]);
  });
});

// The piano's recordings are never downloaded by the tests; when a render has put them in the Node
// cache, the browser loader is served those files and must render the same PCM.
const pianoScore = example("a-grandpiano.json");
const nodePiano = await loadInNode(pianoScore, { cacheDir: defaultCacheDir(), download: false }).catch(() => undefined);

describe.runIf(nodePiano !== undefined)("for the grand piano (only when its recordings are in the cache)", () => {
  it("renders the same PCM", async () => {
    const fromNodeCache: typeof globalThis.fetch = (url) => {
      const file = decodeURIComponent(String(url).split("/").pop() ?? "");
      return Promise.resolve(new Response(new Uint8Array(readFileSync(join(defaultCacheDir(), PIANO_SET, file)))));
    };
    const inBrowser = render(pianoScore, { samples: await loadInBrowser(pianoScore, { cache: false, fetch: fromNodeCache }) }).audio;
    const inNode = render(pianoScore, { samples: nodePiano }).audio;
    expect(inBrowser[0]).toEqual(inNode[0]);
  });
});
