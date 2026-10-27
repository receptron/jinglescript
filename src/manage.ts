// manageJingleScript: the one tool JingleScript offers to LLMs, independent of how it is carried.
// The MCP server wraps it (text and files); the GUI Chat Protocol plugin wraps it (a ToolResult
// whose `data` a player view renders). Each action calls one library function.
import { z } from "zod";
import { AUDIO_FORMATS, MIME_TYPES } from "./audio-format.ts";
import { encodeAudioBytes, FfmpegMissingError } from "./encode.ts";
import { removedInstrument } from "./instruments/index.ts";
import { getAuthoringGuide, getInstrument, getSchema, listInstruments, SCHEMA_PARTS, type SchemaPart } from "./llm.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToFiles } from "./output.ts";
import { scoreToMusicXml } from "./musicxml.ts";
import { deferRender } from "./deferred-renders.ts";
import {
  dataUri,
  pendingPlayerData,
  round1,
  toPlayerData,
  VIEWS,
  wantsNotation,
  wavPlayerAudio,
  type PlayerAudio,
  type PlayerData,
  type Presentation,
} from "./player.ts";
import { render, type RenderResult } from "./render.ts";
import "./render-pool.ts";
import { SampleDownloadError } from "./samples/fetch-sample.ts";
import { loadSamples } from "./samples/load.ts";
import { checkSinger, NeutrinoMissingError, NeutrinoVoiceMissingError } from "./singer/neutrino.ts";
import { checkScore, parseScore, type CheckResult, type Score, type ScoreProblem } from "./score.ts";
import type { TimingMap } from "./timing.ts";
import { tagsOf } from "./tags.ts";

export const MANAGE_TOOL = "manageJingleScript";
export const MANAGE_ACTIONS = ["getGuide", "getSchema", "listInstruments", "getInstrument", "checkScore", "renderScore"] as const;
export type ManageAction = (typeof MANAGE_ACTIONS)[number];

/** A score file the tool call names: a `.json` path, relative or absolute, with no `.` / `..` / empty segment. */
export function isScorePath(value: string): boolean {
  if (!value.toLowerCase().endsWith(".json") || value.includes("\0")) return false;
  const segments = value.replace(/^[A-Za-z]:/, "").split(/[\\/]/);
  return segments.every((segment, i) => (segment === "" ? i === 0 : segment !== "." && segment !== ".."));
}

/** The file stem of a score path ("scores/opening.json" → "opening"), when it is a valid one. */
function stemOf(path: string): string | undefined {
  const stem = path
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.json$/i, "");
  return stem !== undefined && FILE_STEM.test(stem) ? stem : undefined;
}

/** A file stem: letters, digits, dot, dash, underscore — never a path. */
const FILE_STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

const REQUIRED: Record<ManageAction, readonly ("instrument" | "score")[]> = {
  getGuide: [],
  getSchema: [],
  listInstruments: [],
  getInstrument: ["instrument"],
  checkScore: ["score"],
  renderScore: ["score"],
};

export const MANAGE_DESCRIPTION =
  "Write and render jingles and songs (short music, played or sung, with sound effects) plus a timing map an animation can sync to. Start with action getGuide, then getSchema; write a score; checkScore and fix every error; then renderScore. A long score can be written to a .json file and passed as `path` instead of `score`.";

export const ManageInputSchema = z
  .object({
    action: z
      .enum(MANAGE_ACTIONS)
      .describe(
        "What to do. The loop: getGuide (how to write a jingle) → getSchema (the exact format) → write a score → checkScore → fix every error → renderScore. listInstruments / getInstrument show the sounds.",
      ),
    part: z
      .enum(SCHEMA_PARTS)
      .optional()
      .describe('getSchema: one part only ("score" is the whole format, "instrument" a custom instrument\'s, "timing" the timing map\'s).'),
    instrument: z.string().optional().describe("getInstrument: the instrument or sound effect's name."),
    score: z
      .unknown()
      .optional()
      .describe(
        "checkScore, renderScore: the score as a JSON object (format jinglescript/1). A JSON string is accepted too. Give `score` or `path`, not both.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "checkScore, renderScore: path of a score file (.json) to read instead of passing `score` — better for long scores. Relative to the project directory, or absolute. Give `score` or `path`, not both.",
      ),
    fileName: z
      .string()
      .regex(FILE_STEM, { error: 'fileName is a plain file stem such as "opening" — no folders, no extension.' })
      .optional()
      .describe('renderScore: file stem for the outputs (default: the score file\'s name with `path`, otherwise "jingle").'),
    format: z.enum(AUDIO_FORMATS).optional().describe('renderScore: "wav" (default), "mp3" or "ogg" (MP3 and OGG need ffmpeg).'),
    view: z
      .enum(VIEWS)
      .optional()
      .describe(
        'renderScore: what the player shows the user first — "waveform" (default: the sound with its cues and beats) or "notation" (sheet music with a cursor following playback, for teaching and reading music; give the score a `meter`, and `key` when it has one). checkScore: "notation" also reports what the sheet music had to round or shorten. Only where a player view shows the result.',
      ),
    autoplay: z
      .boolean()
      .optional()
      .describe("renderScore: true to start playing as soon as the player appears (once). Only where a player view shows the result."),
    autoplayDelay: z
      .number()
      .min(0)
      .max(30)
      .optional()
      .describe(
        "renderScore with autoplay: seconds the player waits after it appears before it plays. Default: at once, or in a voice chat until you have spoken and fallen quiet. Set it when you will say more than a few words after renderScore.",
      ),
    notifyWhenDone: z
      .boolean()
      .optional()
      .describe(
        'renderScore: true to be told when the user has heard it to the end: the player then sends you one message ("Finished playing …") and you can go on (ask a question about it, play the next exercise). Until then say no more than a few words that it is about to play. Do not wait for it where no player view is shown.',
      ),
    includeTiming: z
      .boolean()
      .optional()
      .describe(
        "renderScore: true to get the whole timing map back (every beat, note and lyric syllable). By default only its summary comes back — tempo, duration, cues, audibleUntil, note counts — which is enough to check that cues land where intended.",
      ),
  })
  .superRefine((input, ctx) => {
    for (const field of REQUIRED[input.action]) {
      if (field === "score") {
        if (input.score === undefined && input.path === undefined) {
          ctx.addIssue({ code: "custom", path: ["score"], message: `${input.action} needs \`score\` (the score itself) or \`path\` (a score file).` });
        } else if (input.score !== undefined && input.path !== undefined) {
          ctx.addIssue({ code: "custom", path: ["path"], message: "Give `score` or `path`, not both." });
        }
      } else if (input[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${input.action} needs \`${field}\`.` });
      }
    }
  });

export type ManageInput = z.infer<typeof ManageInputSchema>;

export interface ManageResult {
  /** For the LLM. */
  text: string;
  isError: boolean;
  /** For a view: present after a successful renderScore when `player` was asked for. */
  player?: PlayerData;
}

export interface ManageOptions {
  /**
   * Reads a score file named by `path` (already checked to be a `.json` path). The carrier decides
   * what a path may reach and what a relative one is relative to. Without it, `path` is refused.
   */
  readScoreFile?: (path: string) => Promise<string>;
  /** Write renders here (MCP). Without it, renderScore writes no files. */
  outDir?: string;
  /** Build PlayerData for a view (GUI Chat Protocol). */
  player?: boolean;
  /**
   * With `player`: when the audio takes longer than `waitMs` (default DEFER_WAIT_MS), answer
   * renderScore without it; with `waitMs` 0, always. The PlayerData is then `pending` (the score,
   * sheet music and timing, no audio) and the view collects the finished one with
   * awaitDeferredPlayer. Only for a carrier whose view can call back.
   */
  deferAudio?: boolean | { waitMs: number };
}

/** How long a deferred renderScore waits for the audio before answering without it: a short jingle is done by then. */
export const DEFER_WAIT_MS = 1000;

/** MP3 when ffmpeg is there (small), otherwise 16-bit WAV. */
async function embeddedAudio(result: RenderResult, score: Score): Promise<PlayerAudio> {
  try {
    return { audio: dataUri(MIME_TYPES.mp3, await encodeAudioBytes(result.audio, result.sampleRate, "mp3", tagsOf(score))), mimeType: MIME_TYPES.mp3 };
  } catch (error) {
    if (!(error instanceof FfmpegMissingError)) throw error;
    return wavPlayerAudio(result, score);
  }
}

function parseMaybeJson(score: unknown): unknown {
  if (typeof score !== "string") return score;
  try {
    const parsed: unknown = JSON.parse(score);
    return parsed;
  } catch {
    return score;
  }
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);
/** Reference data (a schema, the instrument list) goes to the model without indentation: the same content, 40% shorter. */
const compact = (value: unknown): string => JSON.stringify(value);

/** What the score schema says about `instruments` here: their own format is a part of its own, which few scores need. */
const CUSTOM_INSTRUMENTS_STUB = {
  type: "object",
  description:
    'Custom instruments and effects, by name, used in tracks like built-ins: { "softBell": { "base": "glockenspiel", "params": { "decay": 1.5 } } }. Only when no built-in fits; the format of one is getSchema with part "instrument".',
};

/**
 * The schema the model reads: the whole score's leaves out the format of custom instruments
 * (half its length), which getSchema with part "instrument" gives.
 */
function schemaForModel(part: SchemaPart | undefined): Record<string, unknown> {
  const schema = getSchema(part);
  if ((part ?? "score") !== "score") return schema;
  const properties: unknown = schema.properties;
  if (typeof properties !== "object" || properties === null) return schema;
  return { ...schema, properties: { ...properties, instruments: CUSTOM_INSTRUMENTS_STUB } };
}

/** The score the call gave: inline, or read from `path`; or the answer to send back when that fails. */
async function scoreOf(input: ManageInput, options: ManageOptions): Promise<{ ok: true; score: unknown } | { ok: false; result: ManageResult }> {
  const path = input.path;
  if (path === undefined) return { ok: true, score: parseMaybeJson(input.score) };
  const failed = (text: string): { ok: false; result: ManageResult } => ({ ok: false, result: { text, isError: true } });
  if (!isScorePath(path)) return failed(`\`path\` must name a .json file, without \`.\` or \`..\` segments: ${JSON.stringify(path)}.`);
  if (options.readScoreFile === undefined) return failed("This host cannot read files: pass the score itself as `score` instead of `path`.");
  let text: string;
  try {
    text = await options.readScoreFile(path);
  } catch (error) {
    return failed(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}. Check the path, or pass the score itself as \`score\`.`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return { ok: true, score: parsed };
  } catch (error) {
    return failed(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

/** The timing map without its per-beat, per-note and per-syllable lists, which are long and rarely needed by the LLM. */
function timingSummary(timing: TimingMap, trackCount: number, fullTimingAt: string) {
  const notesPerTrack = Array.from({ length: trackCount }, () => 0);
  for (const note of timing.notes) notesPerTrack[note.track] = (notesPerTrack[note.track] ?? 0) + 1;
  return {
    format: timing.format,
    tempo: timing.tempo,
    duration: timing.duration,
    cues: timing.cues,
    audibleUntil: timing.audibleUntil,
    notesPerTrack,
    ...(timing.lyrics ? { lyricLines: timing.lyrics.length } : {}),
    omitted: `beats, notes${timing.lyrics ? " and lyrics" : ""} — ${fullTimingAt}`,
  };
}

/** Writes the score's sheet music next to its audio; undefined when it has none to write. */
async function writeNotation(score: Score, dir: string, stem: string): Promise<string | undefined> {
  const musicxml = scoreToMusicXml(score);
  if (musicxml === undefined) return undefined;
  const file = join(dir, `${stem}.musicxml`);
  await writeFile(file, musicxml);
  return file;
}

/** What the player was asked to do with the render. */
function presentationOf(input: ManageInput): Presentation {
  return {
    view: input.view ?? "waveform",
    autoplay: input.autoplay === true,
    ...(input.autoplayDelay === undefined ? {} : { autoplayDelay: input.autoplayDelay }),
    notifyWhenDone: input.notifyWhenDone === true,
    renderedAt: Date.now(),
  };
}

/** Errors whose message tells the user what to install or set up (ffmpeg, samples, NEUTRINO). */
const isSetupError = (error: unknown): error is Error =>
  error instanceof FfmpegMissingError ||
  error instanceof SampleDownloadError ||
  error instanceof NeutrinoMissingError ||
  error instanceof NeutrinoVoiceMissingError;

/** What to tell the user when the score sings and NEUTRINO or its voice is missing; checked before rendering, so it never surfaces only later (a deferred render). */
function missingSinger(score: Score): ManageResult | undefined {
  try {
    checkSinger(score);
    return undefined;
  } catch (error) {
    if (isSetupError(error)) return { text: error.message, isError: true };
    throw error;
  }
}

/**
 * A valid score that sings, checked for NEUTRINO and its voice too: checkScore answers what
 * renderScore would, so the model learns whether it can sing before it renders (or gives up).
 */
function withSinger(check: CheckResult, raw: unknown): CheckResult {
  if (!check.ok) return check;
  const score = parseScore(raw);
  const track = score.tracks.findIndex((t) => t.sing !== undefined);
  if (track < 0) return check;
  const missing = missingSinger(score);
  if (missing === undefined) return check;
  return { ...check, ok: false, errors: [{ path: `tracks[${track}].sing`, message: missing.text }] };
}

/** The name of the render's files and its title when the score has none. */
const stemFor = (input: ManageInput): string => input.fileName ?? (input.path === undefined ? undefined : stemOf(input.path)) ?? "jingle";

/** How long renderScore waits for the audio before answering without it, or undefined when it always waits. */
function deferWait(options: ManageOptions): number | undefined {
  if (options.player !== true || options.outDir !== undefined || options.deferAudio === undefined || options.deferAudio === false) return undefined;
  return options.deferAudio === true ? DEFER_WAIT_MS : options.deferAudio.waitMs;
}

async function renderAction(input: ManageInput, options: ManageOptions): Promise<ManageResult> {
  const source = await scoreOf(input, options);
  if (!source.ok) return source.result;
  const raw = source.score;
  const view = input.view ?? "waveform";
  const check = checkScore(raw, { notation: view === "notation" });
  if (!check.ok) return { text: json({ ok: false, errors: check.errors }), isError: true };
  const score = parseScore(raw);
  const stem = stemFor(input);
  const missing = missingSinger(score);
  if (missing !== undefined) return missing;
  const waitMs = deferWait(options);
  if (waitMs !== undefined) return deferredRenderAction(input, score, stem, check.warnings, waitMs);
  let files: { audio: string; timing: string } | undefined;
  let result: RenderResult;
  try {
    if (options.outDir === undefined) result = await render(score, { samples: await loadSamples(score) });
    else ({ result, ...files } = await renderToFiles(score, options.outDir, stem, { format: input.format ?? "wav" }));
  } catch (error) {
    if (isSetupError(error)) return { text: error.message, isError: true };
    throw error;
  }
  const notationFile = files && options.outDir !== undefined && wantsNotation(score, view) ? await writeNotation(score, options.outDir, stem) : undefined;
  const fullTimingAt = files ? "in timingFile, or render again with includeTiming: true" : FULL_TIMING_AT;
  const summary = {
    ok: true,
    ...(files ? { audio: files.audio, timingFile: files.timing } : {}),
    ...(notationFile === undefined ? {} : { notationFile }),
    ...renderSummary(input, score, result, check.warnings, fullTimingAt),
  };
  if (!options.player) return { text: json(summary), isError: false };
  const player = toPlayerData(score, result, stem, await embeddedAudio(result, score), presentationOf(input));
  return { text: json(summary), isError: false, player };
}

function renderSummary(input: ManageInput, score: Score, result: RenderResult, warnings: readonly ScoreProblem[], fullTimingAt: string) {
  return {
    loudness: round1(result.stats.loudness),
    truePeak: round1(result.stats.truePeak),
    limitingDb: round1(result.stats.limitingDb),
    belowLoudnessTarget: result.stats.limitedByPeak,
    warnings,
    timing: input.includeTiming ? result.timing : timingSummary(result.timing, score.tracks.length, fullTimingAt),
  };
}

/** The audio for a player, rendered and embedded; `renderedAt` is when it was ready. */
async function renderPlayer(score: Score, stem: string, presentation: Presentation): Promise<{ result: RenderResult; player: PlayerData }> {
  const result = await render(score, { samples: await loadSamples(score) });
  const player = toPlayerData(score, result, stem, await embeddedAudio(result, score), { ...presentation, renderedAt: Date.now() });
  return { result, player };
}

const FULL_TIMING_AT = "render again with includeTiming: true to get them";

/**
 * renderScore for a view that can collect the audio later: the finished result when the audio is
 * ready within `waitMs`, else (and always when `waitMs` is 0) a `pending` player at once while the
 * render goes on.
 */
async function deferredRenderAction(input: ManageInput, score: Score, stem: string, warnings: readonly ScoreProblem[], waitMs: number): Promise<ManageResult> {
  const presentation = presentationOf(input);
  const rendering = renderPlayer(score, stem, presentation);
  let done: { result: RenderResult; player: PlayerData } | undefined;
  try {
    // A render that runs in place (no worker) can finish before even a 0 ms timer: 0 does not wait at all.
    done = waitMs <= 0 ? undefined : await Promise.race([rendering, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs))]);
  } catch (error) {
    if (isSetupError(error)) return { text: error.message, isError: true };
    throw error;
  }
  if (done !== undefined)
    return { text: json({ ok: true, ...renderSummary(input, score, done.result, warnings, FULL_TIMING_AT) }), isError: false, player: done.player };
  const id = deferRender(rendering.then(({ player }) => player));
  const player = pendingPlayerData(score, stem, presentation, id);
  const summary = {
    ok: true,
    audio: "still rendering: the player shows the score now and plays it when the audio is ready (loudness and true peak are not known yet)",
    warnings,
    timing: input.includeTiming ? player.timing : timingSummary(player.timing, score.tracks.length, FULL_TIMING_AT),
  };
  return { text: json(summary), isError: false, player };
}

export async function manage(input: ManageInput, options: ManageOptions = {}): Promise<ManageResult> {
  switch (input.action) {
    case "getGuide":
      return { text: getAuthoringGuide(), isError: false };
    case "getSchema":
      return { text: compact(schemaForModel(input.part)), isError: false };
    case "listInstruments":
      return { text: compact(listInstruments()), isError: false };
    case "getInstrument": {
      const name = input.instrument ?? "";
      const info = getInstrument(name);
      if (info) return { text: json(info), isError: false };
      const unknown = removedInstrument(name) ?? `Unknown instrument "${name}".`;
      return {
        text: `${unknown} Available: ${listInstruments()
          .map((i) => i.name)
          .join(", ")}.`,
        isError: true,
      };
    }
    case "checkScore": {
      const source = await scoreOf(input, options);
      return source.ok
        ? { text: json(withSinger(checkScore(source.score, { notation: input.view === "notation" }), source.score)), isError: false }
        : source.result;
    }
    case "renderScore":
      return renderAction(input, options);
  }
}

/** The tool's input as JSON Schema (for function-calling hosts), from the same zod schema. */
export function manageInputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ManageInputSchema, { io: "input", target: "draft-2020-12" });
}
