import { describe, expect, it } from "vitest";
import type { RenderReply, RenderRequest } from "../playground/messages.ts";
import { createRenderClient, type WorkerLike } from "../playground/render-client.ts";
import { shellQuote, shortcutsApply, sliderSeek } from "../playground/studio/page-rules.ts";

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

describe("shellQuote", () => {
  it("makes any file name one literal shell word", () => {
    expect(shellQuote("my video.mp4")).toBe("'my video.mp4'");
    expect(shellQuote(`a"b$(rm -rf ~)\`x\`\\.mp4`)).toBe(`'a"b$(rm -rf ~)\`x\`\\.mp4'`);
    expect(shellQuote("it's.mp4")).toBe(`'it'\\''s.mp4'`);
    expect(shellQuote("")).toBe("''");
  });
});

describe("shortcutsApply", () => {
  const target = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });
  it("acts on the page, plain elements and the timeline (a div), for every key", () => {
    for (const key of [" ", "m", "Delete"]) {
      expect(shortcutsApply(null, key)).toBe(true);
      expect(shortcutsApply(target("BODY"), key)).toBe(true);
      expect(shortcutsApply(target("div"), key)).toBe(true);
    }
  });
  it("never acts while typing in a field or editable text", () => {
    for (const tag of ["INPUT", "textarea", "SELECT"]) for (const key of [" ", "m", "Delete"]) expect(shortcutsApply(target(tag), key)).toBe(false);
    expect(shortcutsApply(target("DIV", true), "m")).toBe(false);
  });
  it("on a button or link, leaves Space and Enter to it and acts on the other keys", () => {
    for (const tag of ["BUTTON", "a", "SUMMARY"]) {
      expect(shortcutsApply(target(tag), " ")).toBe(false);
      expect(shortcutsApply(target(tag), "Enter")).toBe(false);
      expect(shortcutsApply(target(tag), "m")).toBe(true);
      expect(shortcutsApply(target(tag), "Delete")).toBe(true);
    }
  });
});

describe("sliderSeek", () => {
  it("moves by 0.1 s, 1 s with Shift, to either end with Home/End, and stays on the timeline", () => {
    expect(sliderSeek("ArrowRight", false, 2, 5)).toBeCloseTo(2.1);
    expect(sliderSeek("ArrowLeft", true, 2, 5)).toBe(1);
    expect(sliderSeek("Home", false, 2, 5)).toBe(0);
    expect(sliderSeek("End", false, 2, 5)).toBe(5);
    expect(sliderSeek("ArrowLeft", true, 0.5, 5)).toBe(0);
    expect(sliderSeek("ArrowRight", true, 4.5, 5)).toBe(5);
    expect(sliderSeek("a", false, 2, 5)).toBeUndefined();
  });
});
