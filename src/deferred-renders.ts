// Renders whose result went out before their audio was ready (manage's renderScore with
// `deferAudio`): the view shows the score at once and asks for the finished PlayerData by id.
// Kept in this process's memory for a while after they finish, then dropped; an id that is unknown
// (expired, or the server restarted) answers "gone" and the view asks for a new render.
import type { PlayerData } from "./player.ts";

/** How long a finished render is kept for a view to collect (a card mounted late, a second mount). */
export const DEFERRED_KEEP_MS = 30 * 60_000;

/** What a view gets for a deferred render: the PlayerData with its audio, why it failed, or nothing to give. */
export type DeferredOutcome = { kind: "ready"; player: PlayerData } | { kind: "failed"; message: string } | { kind: "gone" };

interface Entry {
  outcome: Promise<DeferredOutcome>;
  /** When it may be dropped: DEFERRED_KEEP_MS after it settled (Infinity while it runs). */
  expires: number;
}

const entries = new Map<string, Entry>();

function dropExpired(now: number): void {
  for (const [id, entry] of entries) if (entry.expires <= now) entries.delete(id);
}

/** Keeps `player` (still rendering) under a new id, and returns the id. */
export function deferRender(player: Promise<PlayerData>): string {
  dropExpired(Date.now());
  const id = crypto.randomUUID();
  const entry: Entry = {
    outcome: player.then(
      (done): DeferredOutcome => ({ kind: "ready", player: done }),
      (error: unknown): DeferredOutcome => ({ kind: "failed", message: error instanceof Error ? error.message : String(error) }),
    ),
    expires: Infinity,
  };
  void entry.outcome.then(() => {
    entry.expires = Date.now() + DEFERRED_KEEP_MS;
  });
  entries.set(id, entry);
  return id;
}

/** Waits for the deferred render `id` and gives its outcome; "gone" when there is no such render (any more). */
export function awaitDeferredPlayer(id: string): Promise<DeferredOutcome> {
  dropExpired(Date.now());
  return entries.get(id)?.outcome ?? Promise.resolve({ kind: "gone" });
}
