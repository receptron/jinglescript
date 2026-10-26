import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitDeferredPlayer, DEFERRED_KEEP_MS, deferRender } from "../src/deferred-renders.ts";

describe("deferred renders", () => {
  afterEach(() => vi.useRealTimers());

  it("are kept DEFERRED_KEEP_MS after they settle, then dropped without any other activity", async () => {
    vi.useFakeTimers();
    const id = deferRender(Promise.reject(new Error("boom")));
    expect(await awaitDeferredPlayer(id)).toEqual({ kind: "failed", message: "boom" });
    await vi.advanceTimersByTimeAsync(DEFERRED_KEEP_MS - 1);
    expect((await awaitDeferredPlayer(id)).kind).toBe("failed");
    await vi.advanceTimersByTimeAsync(1);
    expect(await awaitDeferredPlayer(id)).toEqual({ kind: "gone" });
  });

  it("are kept for as long as they render", async () => {
    vi.useFakeTimers();
    let finish: (value: never) => void = () => undefined;
    const id = deferRender(new Promise<never>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(DEFERRED_KEEP_MS * 2);
    const waiting = awaitDeferredPlayer(id);
    finish(undefined as never);
    expect((await waiting).kind).toBe("ready");
  });
});
