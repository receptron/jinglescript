// Parsing and checking scores. Errors are written for repair: each says where (a JSON path), what
// is wrong, and what is allowed — an LLM reads them and fixes its score.
import { z } from "zod";
import { BLOCK_SCHEMAS, blockForm, DEFINITION_FORM_SCHEMAS, definitionForm } from "./custom/schema.ts";
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

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    const next: unknown = Reflect.get(value, key);
    value = next;
  }
  return value;
}

/** The schema of the union branch a value under `instruments` was meant for, judged by its key. */
function intendedBranch(path: readonly PropertyKey[], value: unknown): z.ZodType | undefined {
  if (path[0] !== "instruments") return undefined;
  if (path.length === 2) {
    const form = definitionForm(value);
    return form === undefined ? undefined : DEFINITION_FORM_SCHEMAS[form];
  }
  if (path.at(-2) === "blocks") {
    const form = blockForm(value);
    return form === undefined ? undefined : BLOCK_SCHEMAS[form];
  }
  return undefined;
}

/**
 * A custom instrument or block that matches no form only says "invalid input"; validating it
 * against the form its key names gives the problems an LLM can fix.
 */
function precise(issues: readonly z.core.$ZodIssue[], input: unknown): z.core.$ZodIssue[] {
  return issues.flatMap((issue) => {
    if (issue.code !== "invalid_union") return [issue];
    const value = valueAt(input, issue.path);
    const branch = intendedBranch(issue.path, value);
    if (branch === undefined) return [issue];
    const result = branch.safeParse(value);
    if (result.success) return [issue];
    const nested = result.error.issues.map((inner) => ({ ...inner, path: [...issue.path, ...inner.path] }));
    return precise(nested, input);
  });
}

const problemsOf = (error: z.ZodError, input: unknown): ScoreProblem[] => precise(error.issues, input).map(problemOf);

/** Parses and validates a score; throws JingleScriptError listing every problem. */
export function parseScore(input: unknown): Score {
  const result = ScoreSchema.safeParse(input);
  if (!result.success) throw new JingleScriptError(problemsOf(result.error, input));
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
  /** Where every note and sound resolved to, in seconds — to confirm placements without rendering. */
  timeline?: { path: string; instrument: string; t: number; end?: number; cue?: string }[];
  /** Each line of lyrics and when it is shown, to confirm the words land where meant (only when the score has lyrics). */
  lyrics?: { track: number; text: string; t: number; end: number }[];
}

function nearCueWarnings(expanded: Expanded): ScoreProblem[] {
  const warnings: ScoreProblem[] = [];
  for (const event of expanded.events) {
    if (event.cue !== undefined) continue;
    for (const [cue, seconds] of Object.entries(expanded.cues)) {
      const gap = Math.abs(event.nominal - seconds);
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
  if (!result.success) return { ok: false, errors: problemsOf(result.error, input), warnings: [], cues: {} };
  const expanded = expandScore(result.data);
  const cues = Object.fromEntries(
    Object.entries(expanded.cues).map(([name, seconds]) => [
      name,
      { seconds: roundMs(seconds), beat: Math.round(secondsToBeats(seconds, expanded.tempo) * 1000) / 1000 },
    ]),
  );
  const timeline = expanded.events.map((event) => ({
    path: formatPath(["tracks", event.track, "notes", event.note]),
    instrument: event.instrument,
    t: roundMs(event.nominal),
    ...(event.end === undefined ? {} : { end: roundMs(event.end) }),
    ...(event.cue === undefined ? {} : { cue: event.cue }),
  }));
  const lyrics = expanded.lyrics.map((line) => ({ track: line.track, text: line.text, t: roundMs(line.seconds), end: roundMs(line.end) }));
  return {
    ok: true,
    errors: [],
    warnings: nearCueWarnings(expanded),
    cues,
    duration: roundMs(expanded.duration),
    notes: expanded.events.length,
    timeline,
    ...(lyrics.length > 0 ? { lyrics } : {}),
  };
}

export type { Issue };
