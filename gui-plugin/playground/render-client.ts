// The page's side of the render worker. Only the latest request's reply reaches the page: any
// request, or invalidate(), makes earlier replies stale. A worker that fails is replaced before the
// next request, and events from a replaced worker are ignored.
import type { RenderReply, RenderRequest } from "./messages.ts";

/** The part of a Worker the client uses (so tests can pass a fake). */
export interface WorkerLike {
  postMessage(message: RenderRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<RenderReply>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: () => void): void;
}

export interface RenderHandlers {
  onReply(reply: RenderReply): void;
  /** The worker could not load or answer; the next request starts a fresh one. */
  onFailure(message: string): void;
}

export interface RenderClient {
  /** Sends the request as the latest one; its id is assigned here. */
  request(request: Omit<RenderRequest, "id">): void;
  /** Makes every reply in flight stale (the state changed, or nothing is to be rendered). */
  invalidate(): void;
  /** Stops whatever is rendering: a render cannot be interrupted, so the worker is replaced. */
  restart(): void;
  terminate(): void;
}

export const defaultWorker = (): WorkerLike => new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });

export function createRenderClient(handlers: RenderHandlers, makeWorker: () => WorkerLike = defaultWorker): RenderClient {
  let latest = 0;
  let failed = false;
  let worker = start();

  function start(): WorkerLike {
    const started = makeWorker();
    const current = (): boolean => started === worker;
    started.addEventListener("message", (event) => {
      if (current() && event.data.id === latest) handlers.onReply(event.data);
    });
    started.addEventListener("error", (event) => {
      if (!current()) return;
      failed = true;
      handlers.onFailure(`The renderer stopped: ${event.message || "it could not be loaded"}. Reload the page.`);
    });
    started.addEventListener("messageerror", () => {
      if (current()) handlers.onFailure("The renderer's answer could not be read. Reload the page.");
    });
    return started;
  }

  function restart(): void {
    worker.terminate();
    worker = start();
    failed = false;
    latest++;
  }

  return {
    request(request) {
      // A worker can fail before any render is posted, and would then never reply.
      if (failed) restart();
      worker.postMessage({ ...request, id: ++latest });
    },
    invalidate() {
      latest++;
    },
    restart,
    terminate() {
      latest++;
      worker.terminate();
    },
  };
}
