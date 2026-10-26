// Renders whose result went out before their audio was ready (manage's renderScore with
// `deferAudio`): the view shows the score at once and asks for the finished PlayerData by id.
// Kept in this process's memory for a while after they finish, then dropped; an id that is unknown
// (expired, or the server restarted) answers "gone" and the view asks for a new render.
import type { PlayerData } from "./player.ts";

/** How long a finished render is kept for a view to collect (a card mounted late, a second mount). */
export const DEFERRED_KEEP_MS = 30 * 60_000;

/** What a view gets for a deferred render: the PlayerData with its audio, why it failed, or nothing to give. */
export type DeferredOutcome = { kind: "ready"; player: PlayerData } | { kind: "failed"; message: string } | { kind: "gone" };

const entries = new Map<string, Promise<DeferredOutcome>>();

/** Keeps `player` (still rendering) under a new id, and returns the id. */
export function deferRender(player: Promise<PlayerData>): string {
  const id = crypto.randomUUID();
  const outcome = player.then(
    (done): DeferredOutcome => ({ kind: "ready", player: done }),
    (error: unknown): DeferredOutcome => ({ kind: "failed", message: error instanceof Error ? error.message : String(error) }),
  );
  entries.set(id, outcome);
  // Dropped DEFERRED_KEEP_MS after it settles, whatever else happens; unref'd, so it never keeps the process alive.
  void outcome.then(() => setTimeout(() => entries.delete(id), DEFERRED_KEEP_MS).unref());
  return id;
}

/** Waits for the deferred render `id` and gives its outcome; "gone" when there is no such render (any more). */
export function awaitDeferredPlayer(id: string): Promise<DeferredOutcome> {
  return entries.get(id) ?? Promise.resolve({ kind: "gone" });
}
