// Small decisions the studio page makes, kept out of the component so they can be tested.

/** A POSIX shell word for `text`, safe to paste: single quotes, with any single quote spelled '\''. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** What a key press landed on, as far as shortcuts care. */
export interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
}

/** Fields that take every key typed into them. */
const TEXT_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
/** Controls that a key activates: Space and Enter press them, other keys are free. */
const PRESSABLE = new Set(["BUTTON", "A", "SUMMARY"]);
const PRESS_KEYS = new Set([" ", "Enter"]);

/**
 * Whether the page's shortcut for `key` (Space, M, Delete) should act, given what has focus: not
 * while typing in a field, and not when the key would also press the focused button. The timeline
 * uses only the arrows, Home and End, so every shortcut works while it has focus.
 */
export function shortcutsApply(target: KeyTarget | null, key: string): boolean {
  if (target === null) return true;
  const tag = target.tagName.toUpperCase();
  if (TEXT_FIELDS.has(tag) || target.isContentEditable) return false;
  return !(PRESSABLE.has(tag) && PRESS_KEYS.has(key));
}

const SMALL_STEP_SECONDS = 0.1;
const BIG_STEP_SECONDS = 1;

/** Where a key moves the timeline's playhead, or undefined for a key it does not handle. */
export function sliderSeek(key: string, shift: boolean, now: number, duration: number): number | undefined {
  const step = shift ? BIG_STEP_SECONDS : SMALL_STEP_SECONDS;
  const targets: Readonly<Record<string, number>> = { ArrowLeft: now - step, ArrowRight: now + step, Home: 0, End: duration };
  const to = targets[key];
  return to === undefined ? undefined : Math.min(Math.max(0, to), duration);
}
