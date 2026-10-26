// Node: render() on worker threads (render-worker.ts), so a long render — a piano piece, a NEUTRINO
// vocal — never blocks the event loop of the process that asked for it; an MCP server or a GUI host
// keeps answering. Up to POOL_SIZE renders run at once and the rest wait their turn. Idle workers are
// kept for the next render and unref'd, so they never keep the process alive. Importing this module
// registers the pool with render(); without it (the browser, or a bundle that left the worker file
// behind) render() works in place.
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { SHARE_ENV, Worker } from "node:worker_threads";
import type { RenderJob, RenderReply, SerializedError } from "./render-worker.ts";
import { samplesNeeded, setRenderRunner, SingerUnavailableError, type RenderOptions, type RenderResult } from "./render.ts";
import { SampleDownloadError } from "./samples/fetch-sample.ts";
import { loadedSamples, SamplesNotLoadedError, type SampleData, type SampleSource } from "./samples/source.ts";
import { JingleScriptError, type Score } from "./score.ts";
import { NeutrinoMissingError, NeutrinoVoiceMissingError } from "./singer/neutrino.ts";

/** Renders at once: one per core but one, at most two (a GUI host may start several cards together). */
const POOL_SIZE = Math.max(1, Math.min(2, availableParallelism() - 1));

/** Errors a caller tells apart by class; one thrown on a worker is rebuilt as its class by name. */
const ERROR_CLASSES: readonly (abstract new (...args: never[]) => Error)[] = [
  JingleScriptError,
  SamplesNotLoadedError,
  SampleDownloadError,
  SingerUnavailableError,
  NeutrinoMissingError,
  NeutrinoVoiceMissingError,
  TypeError,
  RangeError,
];

function revive(serialized: SerializedError): Error {
  const error = new Error(serialized.message);
  const known = ERROR_CLASSES.find((errorClass) => errorClass.name === serialized.name);
  const prototype: unknown = known?.prototype;
  if (typeof prototype === "object" && prototype !== null) Object.setPrototypeOf(error, prototype);
  Object.assign(error, serialized.props, { name: serialized.name });
  if (serialized.stack !== undefined) error.stack = serialized.stack;
  return error;
}

/** The worker's file next to this one, or undefined when it can't run here (render in place). */
function workerFile(): URL | undefined {
  const fromSource = import.meta.url.endsWith(".ts");
  // Running from src/ on a Node that cannot strip types: the worker could not load its .ts files.
  if (fromSource && !process.features.typescript) return undefined;
  const file = new URL(fromSource ? "./render-worker.ts" : "./render-worker.js", import.meta.url);
  return file.protocol === "file:" && existsSync(fileURLToPath(file)) ? file : undefined;
}

/** The samples a render reads, as plain data a worker can receive. */
function samplesFor(score: Score, source: SampleSource | undefined, seed: number | undefined): ReadonlyMap<string, SampleData> {
  if (source === undefined) return new Map();
  const loaded = loadedSamples(source);
  if (loaded !== undefined) return loaded;
  // A SampleSource of the caller's own: ask it for exactly what this score reads.
  const samples = new Map<string, SampleData>();
  for (const key of samplesNeeded(score, { seed })) {
    const data = source.get(key);
    if (data !== undefined) samples.set(key, data);
  }
  return samples;
}

/**
 * The render options a worker receives: every field of RenderOptions but the samples (sent as data),
 * named one by one so a field added to RenderOptions is a type error here until it is passed on, and
 * so whatever else a caller's options object carries (renderToFiles' onDownload callback) stays behind.
 */
function workerOptions(options: RenderOptions): RenderJob["options"] {
  return { sampleRate: options.sampleRate, seed: options.seed, prerendered: options.prerendered } satisfies Record<keyof RenderJob["options"], unknown>;
}

interface Task {
  job: Omit<RenderJob, "id">;
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
}

const queue: Task[] = [];
const idle: Worker[] = [];
let alive = 0;
let nextId = 0;

function startWorker(url: URL): Worker {
  // SHARE_ENV: NEUTRINO_DIR and the cache settings are read from the caller's environment as it is now.
  const worker = new Worker(url, { env: SHARE_ENV });
  worker.unref();
  alive++;
  worker.on("exit", () => {
    alive--;
    const at = idle.indexOf(worker);
    if (at >= 0) idle.splice(at, 1);
    pump(url);
  });
  return worker;
}

function run(url: URL, worker: Worker, task: Task): void {
  const id = nextId++;
  let settled = false;
  const settle = (): void => {
    settled = true;
    worker.off("message", onMessage);
    worker.off("error", onError);
    worker.off("exit", onExit);
    worker.unref();
  };
  const onMessage = (reply: RenderReply): void => {
    if (reply.id !== id || settled) return;
    settle();
    if ("error" in reply) task.reject(revive(reply.error));
    else task.resolve(reply.result);
    idle.push(worker);
    pump(url);
  };
  const onError = (error: Error): void => {
    if (settled) return;
    settle();
    task.reject(error); // the worker exits next; its exit handler replaces it
  };
  const onExit = (code: number): void => {
    if (settled) return;
    settle();
    task.reject(new Error(`The render worker stopped unexpectedly (exit code ${code}).`));
  };
  worker.on("message", onMessage);
  worker.on("error", onError);
  worker.on("exit", onExit);
  worker.ref(); // a render in progress keeps the process alive until it is done
  try {
    worker.postMessage({ ...task.job, id } satisfies RenderJob);
  } catch (error) {
    settle();
    task.reject(error instanceof Error ? error : new Error(String(error)));
    idle.push(worker);
  }
}

/** Starts queued renders while there is a free worker, or room for another. */
function pump(url: URL): void {
  for (;;) {
    const task = queue[0];
    if (task === undefined) return;
    const worker = idle.pop() ?? (alive < POOL_SIZE ? startWorker(url) : undefined);
    if (worker === undefined) return;
    queue.shift();
    run(url, worker, task);
  }
}

const file = workerFile();
if (file !== undefined) {
  setRenderRunner(
    (score, options) =>
      new Promise<RenderResult>((resolve, reject) => {
        queue.push({ job: { score, options: workerOptions(options), samples: samplesFor(score, options.samples, options.seed) }, resolve, reject });
        pump(file);
      }),
  );
}
