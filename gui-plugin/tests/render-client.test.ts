import { describe, expect, it } from "vitest";
import type { RenderReply, RenderRequest } from "../playground/messages.ts";
import { createRenderClient, type WorkerLike } from "../playground/render-client.ts";

/** A worker the test drives: it records requests and fires the events a real one would. */
class FakeWorker implements WorkerLike {
  readonly posted: RenderRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();
  postMessage(message: RenderRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: "message" | "error" | "messageerror", event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
  reply(reply: RenderReply): void {
    this.fire("message", { data: reply });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const replies: RenderReply[] = [];
  const failures: string[] = [];
  const client = createRenderClient({ onReply: (reply) => replies.push(reply), onFailure: (message) => failures.push(message) }, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const request = { score: {}, name: "x", sfxBaseUrl: "sfx/" };
  const failed = (id: number): RenderReply => ({ id, kind: "failed", message: `render ${id}` });
  return { workers, replies, failures, client, request, failed };
}

describe("createRenderClient", () => {
  it("passes on only the latest request's reply", () => {
    const { workers, replies, client, request, failed } = setup();
    client.request(request);
    client.request(request);
    const [first, second] = workers[0]?.posted ?? [];
    workers[0]?.reply(failed(first?.id ?? -1));
    workers[0]?.reply(failed(second?.id ?? -1));
    expect(replies).toEqual([failed(second?.id ?? -1)]);
  });

  it("drops a reply in flight once invalidated (the state changed before the next request)", () => {
    const { workers, replies, client, request, failed } = setup();
    client.request(request);
    client.invalidate();
    workers[0]?.reply(failed(workers[0].posted[0]?.id ?? -1));
    expect(replies).toEqual([]);
  });

  it("replaces a worker that failed before the next request, and ignores the old one", () => {
    const { workers, replies, failures, client, request, failed } = setup();
    workers[0]?.fire("error", { message: "" });
    expect(failures).toEqual(["The renderer stopped: it could not be loaded. Reload the page."]);
    client.request(request);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[0]?.posted).toEqual([]);
    const id = workers[1]?.posted[0]?.id ?? -1;
    workers[0]?.reply(failed(id));
    workers[0]?.fire("error", { message: "late" });
    expect(replies).toEqual([]);
    expect(failures).toHaveLength(1);
    workers[1]?.reply(failed(id));
    expect(replies).toEqual([failed(id)]);
  });

  it("restart replaces the worker and drops what was rendering; messageerror does not replace it", () => {
    const { workers, replies, failures, client, request, failed } = setup();
    client.request(request);
    const id = workers[0]?.posted[0]?.id ?? -1;
    client.restart();
    workers[1]?.reply(failed(id));
    expect(replies).toEqual([]);
    workers[1]?.fire("messageerror", {});
    expect(failures).toEqual(["The renderer's answer could not be read. Reload the page."]);
    client.request(request);
    expect(workers).toHaveLength(2);
  });
});
