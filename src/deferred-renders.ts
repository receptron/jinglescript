// Renders whose result went out before their audio was ready (manage's renderScore with
// `deferAudio`): the view shows the score at once and asks for the finished PlayerData by id.
// Each holds a whole jingle's audio, so few are kept and not for long: a finished one until a view
// has collected it (then a minute more, for another mount of the same card), at most
// DEFERRED_KEEP_MS, and only the newest MAX_DEFERRED. An id that is unknown (dropped, or the
// server restarted) answers "gone" and the view asks for a new render.
import type { PlayerData } from "./player.ts";

/** How long a finished render is kept for a view that has not collected it yet (a card mounted late). */
export const DEFERRED_KEEP_MS = 30 * 60_000;
/** How long a render is kept after a view collected it: another mount of the card may ask too. */
export const COLLECTED_KEEP_MS = 60_000;
/** Finished renders kept at most; the oldest go first. Renders still running are always kept. */
export const MAX_DEFERRED = 20;

/** What a view gets for a deferred render: the PlayerData with its audio, why it failed, or nothing to give. */
export type DeferredOutcome = { kind: "ready"; player: PlayerData } | { kind: "failed"; message: string } | { kind: "gone" };

interface Entry {
  outcome: Promise<DeferredOutcome>;
  settled: boolean;
}

/** In the order they were deferred. */
const entries = new Map<string, Entry>();

/** Drops `id` after `ms` unless it is gone already; unref'd, so it never keeps the process alive. */
function dropAfter(id: string, ms: number): void {
  setTimeout(() => entries.delete(id), ms).unref();
}

/** Keeps at most MAX_DEFERRED finished renders, dropping the oldest. */
function trim(): void {
  let finished = [...entries.values()].filter((entry) => entry.settled).length;
  for (const [id, entry] of entries) {
    if (finished <= MAX_DEFERRED) return;
    if (!entry.settled) continue;
    entries.delete(id);
    finished--;
  }
}

/** Keeps `player` (still rendering) under a new id, and returns the id. */
export function deferRender(player: Promise<PlayerData>): string {
  const id = crypto.randomUUID();
  const entry: Entry = {
    outcome: player.then(
      (done): DeferredOutcome => ({ kind: "ready", player: done }),
      (error: unknown): DeferredOutcome => ({ kind: "failed", message: error instanceof Error ? error.message : String(error) }),
    ),
    settled: false,
  };
  entries.set(id, entry);
  void entry.outcome.then(() => {
    entry.settled = true;
    dropAfter(id, DEFERRED_KEEP_MS);
    trim();
  });
  return id;
}

/** Waits for the deferred render `id` and gives its outcome; "gone" when there is no such render (any more). */
export async function awaitDeferredPlayer(id: string): Promise<DeferredOutcome> {
  const entry = entries.get(id);
  if (entry === undefined) return { kind: "gone" };
  const outcome = await entry.outcome;
  // Collected: the view keeps it in the result from now on.
  if (outcome.kind === "ready") dropAfter(id, COLLECTED_KEEP_MS);
  return outcome;
}
