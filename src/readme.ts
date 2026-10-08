// The README's "How to write a jingle" section is the authoring guide itself, inserted between
// markers. Shared by the script that writes it and the test that checks it is current.
import { AUTHORING_GUIDE } from "./guide.ts";

export const GUIDE_START = "<!-- guide:start -->";
export const GUIDE_END = "<!-- guide:end -->";

/** The README with the guide (one heading level down) between the markers. */
export function withGuide(readme: string): string {
  const start = readme.indexOf(GUIDE_START);
  const end = readme.indexOf(GUIDE_END);
  if (start < 0 || end < start) throw new Error("README.md has no guide markers");
  const guide = AUTHORING_GUIDE.replace(/^# .*\n+/, "").replace(/^(#+) /gm, "#$1 ");
  return `${readme.slice(0, start + GUIDE_START.length)}\n\n${guide.trim()}\n\n${readme.slice(end)}`;
}
