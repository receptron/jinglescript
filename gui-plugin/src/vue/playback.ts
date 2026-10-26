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
  /** The LLM was told that the audio of a card shown while it rendered could not be made. */
  reported: boolean;
  view: Presentation["view"] | undefined;
}

export function memoryOf(viewState: Record<string, unknown> | undefined): PlayerMemory {
  const view = viewState?.["view"];
  return {
    autoplayed: viewState?.["autoplayed"] === true,
    notified: viewState?.["notified"] === true,
    reported: viewState?.["reported"] === true,
    view: view === "waveform" || view === "notation" ? view : undefined,
  };
}

/** Autoplay was asked for, has not happened, and the render is fresh (not a card replayed from history). */
export function shouldAutoplay(presentation: Presentation | undefined, memory: PlayerMemory, now: number): boolean {
  if (presentation?.autoplay !== true || memory.autoplayed || presentation.renderedAt === undefined) return false;
  const age = now - presentation.renderedAt;
  return age >= 0 && age < FRESH_MS;
}

/** How long the host's voice must have been silent, after it answered, before the player starts or resumes by itself. */
export const QUIET_MS = 1500;
/** How long a new card waits for the voice to answer the render before it plays anyway. */
export const REPLY_MS = 3500;

/** What the card knows about the host's voice (its `isAudioPlaying`), since it appeared. */
export interface VoiceState {
  /** The host has a voice: it passes `isAudioPlaying`. */
  voiced: boolean;
  speaking: boolean;
  /** It has started speaking since the card appeared: the reply to the render has come. */
  answered: boolean;
  shownAt: number;
  /** When it last stopped speaking, if it has since the card appeared. */
  stoppedAt?: number;
}

/**
 * How long to wait before playing by itself: undefined while the voice speaks, else what is left of
 * the wait (0: play now). A voice host speaks and calls renderScore in one turn, and then answers the
 * render's result with a few more words, a moment after the card appears. Playing before that answer
 * puts the music under it, so the card first waits up to REPLY_MS for it, then QUIET_MS after it.
 * `delayMs` (the LLM's autoplayDelay) replaces that first wait, and is kept in any host.
 */
export function quietWait(voice: VoiceState, now: number, delayMs?: number): number | undefined {
  if (voice.speaking) return undefined;
  const afterVoice = voice.stoppedAt === undefined ? 0 : QUIET_MS - (now - voice.stoppedAt);
  // The LLM's delay counts from when the card appeared, whatever the voice did meanwhile.
  if (delayMs !== undefined) return Math.max(0, delayMs - (now - voice.shownAt), afterVoice);
  if (voice.answered) return Math.max(0, afterVoice);
  if (!voice.voiced) return 0;
  return Math.max(0, REPLY_MS - (now - (voice.stoppedAt ?? voice.shownAt)));
}

/** The one message sent to the LLM when playback first reaches the end, if it asked for it. */
export function finishedMessage(presentation: Presentation | undefined, memory: PlayerMemory, title: string, duration: number): string | undefined {
  if (presentation?.notifyWhenDone !== true || memory.notified) return undefined;
  return `"${title}" finished playing (${duration.toFixed(1)} s): the user has heard it to the end.`;
}

/**
 * The one message sent to the LLM when the audio of a card shown while it rendered could not be
 * made: its answer to renderScore said it would play. Only for a fresh render, never one from history.
 */
export function failedMessage(presentation: Presentation | undefined, memory: PlayerMemory, title: string, reason: string, now: number): string | undefined {
  if (memory.reported || presentation?.renderedAt === undefined || now - presentation.renderedAt >= FRESH_MS) return undefined;
  return `"${title}" could not be rendered after all, so it did not play: ${reason}`;
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
