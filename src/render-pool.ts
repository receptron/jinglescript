// Node: render() on worker threads (render-worker.ts), so a long render — a piano piece, a NEUTRINO
// vocal — never blocks the event loop of the process that asked for it; an MCP server or a GUI host
// keeps answering. Up to POOL_SIZE renders run at once (one of them sung: NEUTRINO uses every core)
// and the rest wait their turn. Idle workers are kept for the next render and unref'd, so they never
// keep the process alive. Importing this module registers the pool with render(); where no worker
// can run (a bundle that left the worker file behind) it says so once, and render() works in place.
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { SHARE_ENV, Worker } from "node:worker_threads";
import type { RenderJob, RenderReply, SerializedError } from "./render-worker.ts";
import { samplesNeeded, setRenderRunner, SingerUnavailableError, sungTrack, type RenderOptions, type RenderProgress, type RenderResult } from "./render.ts";
import { SampleDownloadError } from "./samples/fetch-sample.ts";
import { loadedSamples, SamplesNotLoadedError, type SampleData, type SampleSource } from "./samples/source.ts";
import { JingleScriptError, type Score } from "./score.ts";
import { NeutrinoMissingError, NeutrinoVoiceMissingError, neutrinoProgress } from "./singer/neutrino.ts";

/** How often the file a running NEUTRINO reports its progress in is read, ms. */
const PROGRESS_POLL_MS = 500;

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

/** The worker's file next to this one, or why there is none here (then render() works in place). */
function workerFile(): { url: URL; missing?: undefined } | { url?: undefined; missing: string } {
  const fromSource = import.meta.url.endsWith(".ts");
  if (fromSource && !process.features.typescript) return { missing: "running from src/ on a Node that cannot strip types (before 22.18)" };
  const url = new URL(fromSource ? "./render-worker.ts" : "./render-worker.js", import.meta.url);
  if (url.protocol !== "file:" || !existsSync(fileURLToPath(url))) return { missing: `${url.href} is missing (bundled without it?)` };
  return { url };
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
 * The render options a worker receives: every field of RenderOptions but the samples (sent as data)
 * and onProgress (the pool calls it with what the worker reports),
 * named one by one so a field added to RenderOptions is a type error here until it is passed on, and
 * so whatever else a caller's options object carries (renderToFiles' onDownload callback) stays behind.
 */
function workerOptions(options: RenderOptions): RenderJob["options"] {
  return { sampleRate: options.sampleRate, seed: options.seed, prerendered: options.prerendered } satisfies Record<keyof RenderJob["options"], unknown>;
}

/** Whether a score sings: NEUTRINO uses every core, so sung renders run one at a time. */
function sings(score: Score): boolean {
  try {
    return sungTrack(score) !== undefined;
  } catch {
    return false; // more than one sung track: the worker reports it
  }
}

interface Task {
  job: Omit<RenderJob, "id">;
  sung: boolean;
  onProgress: ((progress: RenderProgress) => void) | undefined;
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
}

const queue: Task[] = [];
const idle: Worker[] = [];
let alive = 0;
let singing = 0;
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

/** Reads NEUTRINO's progress from `file` until cleared: the worker running it is blocked meanwhile. */
function pollNeutrino(file: string, onProgress: (progress: RenderProgress) => void): ReturnType<typeof setInterval> {
  let last: number | undefined;
  const timer = setInterval(() => {
    let printed: string;
    try {
      printed = readFileSync(file, "utf8");
    } catch {
      return; // not written yet, or removed as NEUTRINO finished
    }
    const done = neutrinoProgress(printed);
    if (done === undefined || done === last) return;
    last = done;
    onProgress({ stage: "singing", done });
  }, PROGRESS_POLL_MS);
  timer.unref();
  return timer;
}

function run(url: URL, worker: Worker, task: Task): void {
  const id = nextId++;
  let settled = false;
  let polling: ReturnType<typeof setInterval> | undefined;
  if (task.sung) singing++;
  const settle = (): void => {
    settled = true;
    clearInterval(polling);
    if (task.sung) singing--;
    worker.off("message", onMessage);
    worker.off("error", onError);
    worker.off("exit", onExit);
    worker.unref();
  };
  const onMessage = (reply: RenderReply): void => {
    if (reply.id !== id || settled) return;
    if ("progress" in reply || "neutrinoLog" in reply) {
      clearInterval(polling);
      if (task.onProgress === undefined) return;
      polling = "neutrinoLog" in reply ? pollNeutrino(reply.neutrinoLog, task.onProgress) : undefined;
      if ("progress" in reply) task.onProgress(reply.progress);
      return;
    }
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

/** Starts queued renders, in order, while there is a free worker or room for another; a sung one waits for the one singing. */
function pump(url: URL): void {
  for (;;) {
    const next = queue.findIndex((task) => !task.sung || singing === 0);
    const task = queue[next];
    if (task === undefined) return;
    const worker = idle.pop() ?? (alive < POOL_SIZE ? startWorker(url) : undefined);
    if (worker === undefined) return;
    queue.splice(next, 1);
    run(url, worker, task);
  }
}

const { url: workerUrl, missing } = workerFile();
if (workerUrl === undefined) {
  // Said once, not silently: rendering in place gives the same audio but blocks this thread meanwhile.
  process.emitWarning(`jinglescript renders on the calling thread, not a worker: ${missing}. A long render blocks this process meanwhile.`, {
    code: "JINGLESCRIPT_NO_RENDER_WORKER",
  });
} else {
  setRenderRunner(
    (score, options) =>
      new Promise<RenderResult>((resolve, reject) => {
        const job = { score, options: workerOptions(options), samples: samplesFor(score, options.samples, options.seed) };
        queue.push({ job, sung: sings(score), onProgress: options.onProgress, resolve, reject });
        pump(workerUrl);
      }),
  );
}
