// Parsing and checking scores. Errors are written for repair: each says where (a JSON path), what
// is wrong, and what is allowed — an LLM reads them and fixes its score.
import { z } from "zod";
import { expandScore, type Expanded, type Issue } from "./events.ts";
import { ScoreBaseSchema, type ScoreData } from "./score-schema.ts";
import { roundMs, secondsToBeats } from "./time.ts";

/** The full score schema: structure plus the checks that need the whole score. */
export const ScoreSchema = ScoreBaseSchema.superRefine((score, ctx) => {
  for (const issue of expandScore(score).issues) {
    ctx.addIssue({ code: "custom", message: issue.message, path: issue.path, params: { hint: issue.hint } });
  }
});

export type Score = ScoreData;

export interface ScoreProblem {
  /** JSON path such as `tracks[0].notes[3].at`; empty for the score as a whole. */
  path: string;
  message: string;
  hint?: string;
}

export class JingleScriptError extends Error {
  readonly problems: ScoreProblem[];
  constructor(problems: ScoreProblem[]) {
    super(`Invalid score:\n${problems.map(formatProblem).join("\n")}`);
    this.name = "JingleScriptError";
    this.problems = problems;
  }
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out === "" ? String(key) : `.${String(key)}`;
  }
  return out;
}

export function formatProblem(problem: ScoreProblem): string {
  const hint = problem.hint ? ` ${problem.hint}` : "";
  return `  ${problem.path || "(score)"}: ${problem.message}${hint}`;
}

function problemOf(issue: z.core.$ZodIssue): ScoreProblem {
  const path = formatPath(issue.path);
  if (issue.code === "custom") {
    const hint: unknown = issue.params?.hint;
    return typeof hint === "string" ? { path, message: issue.message, hint } : { path, message: issue.message };
  }
  if (issue.code === "unrecognized_keys") {
    return {
      path,
      message: `Unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => JSON.stringify(k)).join(", ")}.`,
      hint: "Remove it or check the spelling; unknown fields are errors.",
    };
  }
  if (issue.code === "invalid_type" && issue.message.endsWith("received undefined")) {
    return { path, message: `Missing required field (expected ${issue.expected}).` };
  }
  return { path, message: issue.message };
}

/** Parses and validates a score; throws JingleScriptError listing every problem. */
export function parseScore(input: unknown): Score {
  const result = ScoreSchema.safeParse(input);
  if (!result.success) throw new JingleScriptError(result.error.issues.map(problemOf));
  return result.data;
}

/** A note this close to a cue, but not placed on it, was probably meant to be. */
const NEAR_CUE_SECONDS = 0.01;

export interface CheckResult {
  ok: boolean;
  errors: ScoreProblem[];
  /** Things that are valid but probably not what was meant. */
  warnings: ScoreProblem[];
  /** Each cue's time and the beat it falls on (so rhythm can be lined up with it). */
  cues: Record<string, { seconds: number; beat: number }>;
  duration?: number;
  notes?: number;
}

function nearCueWarnings(expanded: Expanded): ScoreProblem[] {
  const warnings: ScoreProblem[] = [];
  for (const event of expanded.events) {
    if (event.cue !== undefined) continue;
    for (const [cue, seconds] of Object.entries(expanded.cues)) {
      const gap = Math.abs(event.seconds - seconds);
      if (gap > 0 && gap < NEAR_CUE_SECONDS) {
        warnings.push({
          path: formatPath(["tracks", event.track, "notes", event.note, "at"]),
          message: `Starts ${(gap * 1000).toFixed(1)} ms from cue "${cue}" but is not placed on it.`,
          hint: `If it belongs to the cue, write "at": "${cue}".`,
        });
      }
    }
  }
  return warnings;
}

/** Checks a score without throwing: errors with paths and hints, and what the score resolves to. */
export function checkScore(input: unknown): CheckResult {
  const result = ScoreSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: result.error.issues.map(problemOf), warnings: [], cues: {} };
  const expanded = expandScore(result.data);
  const cues = Object.fromEntries(
    Object.entries(expanded.cues).map(([name, seconds]) => [
      name,
      { seconds: roundMs(seconds), beat: Math.round(secondsToBeats(seconds, expanded.tempo) * 1000) / 1000 },
    ]),
  );
  return { ok: true, errors: [], warnings: nearCueWarnings(expanded), cues, duration: roundMs(expanded.duration), notes: expanded.events.length };
}

export type { Issue };
