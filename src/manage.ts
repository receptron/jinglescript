// manageJingleScript: the one tool JingleScript offers to LLMs, independent of how it is carried.
// The MCP server wraps it (text and files); the GUI Chat Protocol plugin wraps it (a ToolResult
// whose `data` a player view renders). Each action calls one library function.
import { z } from "zod";
import { AUDIO_FORMATS, encodeAudioBytes, FfmpegMissingError, MIME_TYPES, type AudioFormat } from "./encode.ts";
import { getAuthoringGuide, getInstrument, getSchema, listInstruments, SCHEMA_PARTS } from "./llm.ts";
import { renderToFiles } from "./output.ts";
import { MIDI_MIME_TYPE, scoreToMidi } from "./midi.ts";
import { render, type RenderResult } from "./render.ts";
import { SampleDownloadError, loadSamples } from "./samples/load.ts";
import { checkScore, parseScore, type Score } from "./score.ts";
import type { TimingMap } from "./timing.ts";
import { toWav } from "./wav.ts";

export const MANAGE_TOOL = "manageJingleScript";
export const MANAGE_ACTIONS = ["getGuide", "getSchema", "listInstruments", "getInstrument", "checkScore", "renderScore"] as const;
export type ManageAction = (typeof MANAGE_ACTIONS)[number];

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
  "Write and render jingles (short music with sound effects) plus a timing map an animation can sync to. Start with action getGuide, then getSchema; write a score; checkScore and fix every error; then renderScore.";

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
    score: z.unknown().optional().describe("checkScore, renderScore: the score as a JSON object (format jinglescript/1). A JSON string is accepted too."),
    fileName: z
      .string()
      .regex(FILE_STEM, { error: 'fileName is a plain file stem such as "opening" — no folders, no extension.' })
      .optional()
      .describe('renderScore: file stem for the outputs (default "jingle").'),
    format: z.enum(AUDIO_FORMATS).optional().describe('renderScore: "wav" (default), "mp3" or "ogg" (MP3 and OGG need ffmpeg).'),
    includeTiming: z
      .boolean()
      .optional()
      .describe(
        "renderScore: true to get the whole timing map back (every beat, note and lyric syllable). By default only its summary comes back — tempo, duration, cues, audibleUntil, note counts — which is enough to check that cues land where intended.",
      ),
  })
  .superRefine((input, ctx) => {
    for (const field of REQUIRED[input.action]) {
      if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `${input.action} needs \`${field}\`.` });
    }
  });

export type ManageInput = z.infer<typeof ManageInputSchema>;

/** What a player view needs to play a rendered jingle and show its timing. */
export interface PlayerData {
  title: string;
  /** The audio as a data URI. */
  audio: string;
  mimeType: string;
  duration: number;
  /** Peak level per slice of the audio, 0–1, for drawing the waveform. */
  peaks: number[];
  timing: TimingMap;
  /** Instrument per track, in order. */
  tracks: string[];
  loudness: number;
  /** The score that was rendered, with its defaults filled in. */
  score: Score;
  /** The score as a Standard MIDI File, as a data URI. */
  midi: string;
}

export interface ManageResult {
  /** For the LLM. */
  text: string;
  isError: boolean;
  /** For a view: present after a successful renderScore when `player` was asked for. */
  player?: PlayerData;
}

export interface ManageOptions {
  /** Write renders here (MCP). Without it, renderScore writes no files. */
  outDir?: string;
  /** Build PlayerData for a view (GUI Chat Protocol). */
  player?: boolean;
}

const PEAK_SLICES = 600;

function peaksOf(audio: readonly Float32Array[]): number[] {
  const length = audio[0]?.length ?? 0;
  const size = Math.max(1, Math.ceil(length / PEAK_SLICES));
  const peaks: number[] = [];
  for (let start = 0; start < length; start += size) {
    let peak = 0;
    for (const channel of audio) for (let i = start; i < Math.min(length, start + size); i++) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
    peaks.push(Math.round(peak * 1000) / 1000);
  }
  return peaks;
}

/** MP3 when ffmpeg is there (small), otherwise 16-bit WAV. */
async function embeddedAudio(result: RenderResult): Promise<{ audio: string; mimeType: string }> {
  let format: AudioFormat = "mp3";
  let bytes: Uint8Array;
  try {
    bytes = await encodeAudioBytes(result.audio, result.sampleRate, "mp3");
  } catch (error) {
    if (!(error instanceof FfmpegMissingError)) throw error;
    format = "wav";
    bytes = toWav(result.audio, result.sampleRate, 16);
  }
  return { audio: `data:${MIME_TYPES[format]};base64,${Buffer.from(bytes).toString("base64")}`, mimeType: MIME_TYPES[format] };
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
const round1 = (x: number): number => Math.round(x * 10) / 10;

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

async function renderAction(input: ManageInput, options: ManageOptions): Promise<ManageResult> {
  const raw = parseMaybeJson(input.score);
  const check = checkScore(raw);
  if (!check.ok) return { text: json({ ok: false, errors: check.errors }), isError: true };
  const score = parseScore(raw);
  const stem = input.fileName ?? "jingle";
  let files: { audio: string; timing: string } | undefined;
  let result: RenderResult;
  try {
    if (options.outDir === undefined) result = render(score, { samples: await loadSamples(score) });
    else ({ result, ...files } = await renderToFiles(score, options.outDir, stem, { format: input.format ?? "wav" }));
  } catch (error) {
    if (error instanceof FfmpegMissingError || error instanceof SampleDownloadError) return { text: error.message, isError: true };
    throw error;
  }
  const fullTimingAt = files ? "in timingFile, or render again with includeTiming: true" : "render again with includeTiming: true to get them";
  const summary = {
    ok: true,
    ...(files ? { audio: files.audio, timingFile: files.timing } : {}),
    loudness: round1(result.stats.loudness),
    truePeak: round1(result.stats.truePeak),
    limitingDb: round1(result.stats.limitingDb),
    belowLoudnessTarget: result.stats.limitedByPeak,
    warnings: check.warnings,
    timing: input.includeTiming ? result.timing : timingSummary(result.timing, score.tracks.length, fullTimingAt),
  };
  if (!options.player) return { text: json(summary), isError: false };
  const player: PlayerData = {
    title: score.title ?? stem,
    ...(await embeddedAudio(result)),
    duration: result.timing.duration,
    peaks: peaksOf(result.audio),
    timing: result.timing,
    tracks: score.tracks.map((t) => t.name ?? t.instrument),
    loudness: round1(result.stats.loudness),
    score,
    midi: `data:${MIDI_MIME_TYPE};base64,${Buffer.from(scoreToMidi(score)).toString("base64")}`,
  };
  return { text: json(summary), isError: false, player };
}

export async function manage(input: ManageInput, options: ManageOptions = {}): Promise<ManageResult> {
  switch (input.action) {
    case "getGuide":
      return { text: getAuthoringGuide(), isError: false };
    case "getSchema":
      return { text: json(getSchema(input.part)), isError: false };
    case "listInstruments":
      return { text: json(listInstruments()), isError: false };
    case "getInstrument": {
      const info = getInstrument(input.instrument ?? "");
      if (info) return { text: json(info), isError: false };
      return {
        text: `Unknown instrument "${input.instrument ?? ""}". Available: ${listInstruments()
          .map((i) => i.name)
          .join(", ")}.`,
        isError: true,
      };
    }
    case "checkScore":
      return { text: json(checkScore(parseMaybeJson(input.score))), isError: false };
    case "renderScore":
      return renderAction(input, options);
  }
}

/** The tool's input as JSON Schema (for function-calling hosts), from the same zod schema. */
export function manageInputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ManageInputSchema, { io: "input", target: "draft-2020-12" });
}
