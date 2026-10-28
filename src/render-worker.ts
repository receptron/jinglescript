// A render worker thread (started by render-pool.ts): renders one score at a time with renderNow and
// sends the audio back without copying it. NEUTRINO is registered here, so a sung track's vocal is
// also made on this thread, and only this thread waits for it. Progress goes out as it comes; while
// NEUTRINO runs this thread is blocked, so it sends the file NEUTRINO writes its progress to instead.
import { parentPort } from "node:worker_threads";
import { renderNow, type RenderOptions, type RenderProgress, type RenderResult } from "./render.ts";
import { sampleSourceOf, type SampleData } from "./samples/source.ts";
import type { Score } from "./score.ts";
import { onNeutrinoProgressLog } from "./singer/neutrino.ts";

/** One render, as the pool sends it: the samples as plain data (a SampleSource holds a function). */
export interface RenderJob {
  id: number;
  score: Score;
  options: Omit<RenderOptions, "samples" | "onProgress">;
  samples: ReadonlyMap<string, SampleData>;
}

/** An error thrown on the worker, for the pool to rebuild as its class (instanceof works for the caller). */
export interface SerializedError {
  name: string;
  message: string;
  stack: string | undefined;
  /** The error's own fields (JingleScriptError.problems, NeutrinoVoiceMissingError.installed, …). */
  props: Record<string, unknown>;
}

/** The render's outcome, or (before it) how far it is: a stage, or the file NEUTRINO reports its progress in. */
export type RenderReply =
  | { id: number; result: RenderResult }
  | { id: number; error: SerializedError }
  | { id: number; progress: RenderProgress }
  | { id: number; neutrinoLog: string };

function serialize(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error), stack: undefined, props: {} };
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    try {
      props[key] = structuredClone(value);
    } catch {
      // a field that cannot cross threads (a function, a socket) is left out
    }
  }
  return { name: error.name, message: error.message, stack: error.stack, props };
}

const port = parentPort;
if (port === null) throw new Error("render-worker.ts runs only as a worker thread (render-pool.ts starts it).");

port.on("message", (job: RenderJob) => {
  let result: RenderResult;
  const onProgress = (progress: RenderProgress): void => port.postMessage({ id: job.id, progress } satisfies RenderReply);
  onNeutrinoProgressLog((neutrinoLog) => port.postMessage({ id: job.id, neutrinoLog } satisfies RenderReply));
  try {
    result = renderNow(job.score, { ...job.options, samples: sampleSourceOf(job.samples), onProgress });
  } catch (error) {
    port.postMessage({ id: job.id, error: serialize(error) } satisfies RenderReply);
    return;
  } finally {
    onNeutrinoProgressLog(undefined);
  }
  // The audio buffers move to the caller instead of being copied.
  const buffers = result.audio.flatMap((channel) => (channel.buffer instanceof ArrayBuffer ? [channel.buffer] : []));
  port.postMessage({ id: job.id, result } satisfies RenderReply, buffers);
});
