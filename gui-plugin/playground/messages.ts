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
  /** Samples are loaded; rendering `seconds` of audio, which for a long piece takes minutes. */
  | { id: number; kind: "rendering"; seconds: number }
  | { id: number; kind: "invalid"; errors: ScoreProblem[] }
  /** `player.audio` is empty: the WAV comes as `wav` (transferred, not copied). */
  | { id: number; kind: "done"; player: PlayerData; wav: ArrayBuffer; warnings: ScoreProblem[]; downloads: number; ms: number }
  | { id: number; kind: "failed"; message: string };
