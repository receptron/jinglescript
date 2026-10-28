import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitDeferredPlayer, COLLECTED_KEEP_MS, DEFERRED_KEEP_MS, deferRender, deferredRenderProgress, MAX_DEFERRED } from "../src/deferred-renders.ts";
import type { RenderProgress } from "../src/render.ts";
import type { PlayerData } from "../src/player.ts";

const player = {} as PlayerData;

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
    let finish: ((done: PlayerData) => void) | undefined;
    const id = deferRender(
      new Promise<PlayerData>((resolve) => {
        finish = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(DEFERRED_KEEP_MS * 2);
    const waiting = awaitDeferredPlayer(id);
    finish?.(player);
    expect((await waiting).kind).toBe("ready");
  });

  it("are dropped COLLECTED_KEEP_MS after a view collected the audio", async () => {
    vi.useFakeTimers();
    const id = deferRender(Promise.resolve(player));
    expect((await awaitDeferredPlayer(id)).kind).toBe("ready");
    await vi.advanceTimersByTimeAsync(COLLECTED_KEEP_MS - 1);
    expect((await awaitDeferredPlayer(id)).kind).toBe("ready"); // a second mount of the card
    await vi.advanceTimersByTimeAsync(COLLECTED_KEEP_MS);
    expect((await awaitDeferredPlayer(id)).kind).toBe("gone");
  });

  it("keep only the newest MAX_DEFERRED finished ones, and every one still running", async () => {
    let finish: ((done: PlayerData) => void) | undefined;
    const running = deferRender(
      new Promise<PlayerData>((resolve) => {
        finish = resolve;
      }),
    );
    const ids = Array.from({ length: MAX_DEFERRED + 3 }, () => deferRender(Promise.reject(new Error("x"))));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const kinds = await Promise.all(ids.map(async (id) => (await awaitDeferredPlayer(id)).kind));
    expect(kinds.filter((kind) => kind === "gone")).toHaveLength(3);
    expect(kinds.slice(0, 3)).toEqual(["gone", "gone", "gone"]);
    const waiting = awaitDeferredPlayer(running);
    finish?.(player);
    expect((await waiting).kind).toBe("ready");
  });

  it("tell how far a render is while it renders, and nothing once it is done or for an unknown id", async () => {
    const reported: { latest?: RenderProgress } = {};
    let finish: ((done: PlayerData) => void) | undefined;
    const id = deferRender(
      new Promise<PlayerData>((resolve) => {
        finish = resolve;
      }),
      () => reported.latest,
    );
    expect(deferredRenderProgress(id)).toBeUndefined();
    reported.latest = { stage: "singing", done: 0.4 };
    expect(deferredRenderProgress(id)).toEqual({ stage: "singing", done: 0.4 });
    finish?.(player);
    await awaitDeferredPlayer(id);
    expect(deferredRenderProgress(id)).toBeUndefined();
    expect(deferredRenderProgress("no-such-render")).toBeUndefined();
  });
});
