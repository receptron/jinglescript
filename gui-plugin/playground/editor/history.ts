// Undo and redo over snapshots of the score's JSON text.

const MAX_STEPS = 200;

export interface History {
  past: readonly string[];
  future: readonly string[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** `current` is about to be replaced by an edit: keep it to come back to. */
export function record(history: History, current: string): History {
  return { past: [...history.past, current].slice(-MAX_STEPS), future: [] };
}

/** The text to go back to, and the history after it; undefined when there is nothing to undo. */
export function undo(history: History, current: string): { text: string; history: History } | undefined {
  const text = history.past.at(-1);
  if (text === undefined) return undefined;
  return { text, history: { past: history.past.slice(0, -1), future: [current, ...history.future] } };
}

export function redo(history: History, current: string): { text: string; history: History } | undefined {
  const [text, ...future] = history.future;
  if (text === undefined) return undefined;
  return { text, history: { past: [...history.past, current], future } };
}
