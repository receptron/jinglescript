// What the page and the render worker say to each other.
import type { PlayerData, ScoreProblem } from "jinglescript/browser";

export interface RenderRequest {
  id: number;
  score: unknown;
  /** Used when the score has no title. */
  name: string;
  /** Where the recorded effects are served (next to the page). */
  sfxBaseUrl: string;
}

export type RenderReply =
  | { id: number; kind: "downloading"; file: string; count: number }
  | { id: number; kind: "invalid"; errors: ScoreProblem[] }
  | { id: number; kind: "done"; player: PlayerData; warnings: ScoreProblem[]; downloads: number; ms: number }
  | { id: number; kind: "failed"; message: string };
