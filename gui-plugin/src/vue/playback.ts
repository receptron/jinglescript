// Pure rules for the player: when a card may start by itself, when it tells the LLM it has been
// heard, what it remembers, and where the sheet-music cursor stands. Hosts mount every card of a
// chat and remount them often (a reload, another session, the pane reopened), so what happened
// once is kept in the result's viewState, and only a fresh render plays by itself.
import type { Presentation } from "jinglescript";

/** A render older than this is history: shown again, never autoplayed. */
export const FRESH_MS = 120_000;

export const VIEW_LABELS = { waveform: "Waveform", notation: "Sheet music" } as const;

/** What the card remembers in the result's viewState. */
export interface PlayerMemory {
  autoplayed: boolean;
  notified: boolean;
  view: Presentation["view"] | undefined;
}

export function memoryOf(viewState: Record<string, unknown> | undefined): PlayerMemory {
  const view = viewState?.["view"];
  return {
    autoplayed: viewState?.["autoplayed"] === true,
    notified: viewState?.["notified"] === true,
    view: view === "waveform" || view === "notation" ? view : undefined,
  };
}

/** Autoplay was asked for, has not happened, and the render is fresh (not a card replayed from history). */
export function shouldAutoplay(presentation: Presentation | undefined, memory: PlayerMemory, now: number): boolean {
  if (presentation?.autoplay !== true || memory.autoplayed || presentation.renderedAt === undefined) return false;
  const age = now - presentation.renderedAt;
  return age >= 0 && age < FRESH_MS;
}

/** The one message sent to the LLM when playback first reaches the end, if it asked for it. */
export function finishedMessage(presentation: Presentation | undefined, memory: PlayerMemory, title: string, duration: number): string | undefined {
  if (presentation?.notifyWhenDone !== true || memory.notified) return undefined;
  return `"${title}" finished playing (${duration.toFixed(1)} s): the user has heard it to the end.`;
}

/** Index of the last cursor position at or before `seconds` (positions are onsets, in seconds, ascending). */
export function cursorIndex(positions: readonly number[], seconds: number): number {
  let low = 0;
  let high = positions.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((positions[mid] ?? 0) <= seconds + 1e-6) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
