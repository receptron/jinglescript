// Captions for a video from a JingleScript timing map, as an ASS subtitle file that ffmpeg burns in
// (`-vf subtitles=captions.ass`): the score's lyrics as karaoke lines that fill syllable by
// syllable, and short telops that pop in on cues. Pure: the caller reads and writes the files.
import { z } from "zod";
import type { TimingMap } from "../../src/index.ts";

export const TelopSchema = z.strictObject({
  at: z.union([z.string(), z.number()]).describe("A cue name from the timing map, or seconds."),
  text: z.string().min(1),
  hold: z.number().positive().default(0.8).describe("Seconds on screen."),
});
export const TelopsSchema = z.array(TelopSchema);
export type Telop = z.infer<typeof TelopSchema>;

export interface CaptionOptions {
  /** A font with the script's characters (Japanese needs a CJK font). */
  font: string;
}

const CENTISECONDS_PER_SECOND = 100;
// A 16:9 canvas; libass scales it to the video's real size.
const PLAY_RES_X = 640;
const PLAY_RES_Y = 360;
const LYRICS_SIZE = 34;
const TELOP_SIZE = 44;
const POP_MS = 120;
const FADE_OUT_MS = 200;

const centiseconds = (seconds: number): number => Math.round(seconds * CENTISECONDS_PER_SECOND);

/** ASS time: H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = centiseconds(Math.max(0, seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

// libass has no escape for a backslash: `\N`, `\h` and `\n` act even after another backslash. A
// word joiner (invisible, no break) after each one keeps it from starting a command.
const WORD_JOINER = "\u2060";

/** Text as ASS shows it: commands and braces literally, and a newline in the text as a line break. */
export const literal = (text: string): string =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replaceAll("\\", `\\${WORD_JOINER}`).replace(/[{}]/g, (brace) => `\\${brace}`))
    .join("\\N");

function header(options: CaptionOptions): string {
  // Colours are &HAABBGGRR. Karaoke fills from the secondary (white) to the primary (yellow) colour.
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${PLAY_RES_X}`,
    `PlayResY: ${PLAY_RES_Y}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Lyrics,${options.font},${LYRICS_SIZE},&H0000E5FF,&H00FFFFFF,&H00202020,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,20,20,24,1`,
    `Style: Telop,${options.font},${TELOP_SIZE},&H0000C8FF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,8,20,20,24,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

type LyricLine = NonNullable<TimingMap["lyrics"]>[number];

/** One karaoke line: each syllable fills over the time until the next one starts (its own end, for the last). */
function karaokeLine(line: LyricLine): string {
  const start = line.syllables[0]?.t ?? line.t;
  const parts = line.syllables.map((syllable, i) => {
    const until = line.syllables[i + 1]?.t ?? syllable.end;
    // Cumulative rounding, so the fills add up to the line's length instead of drifting.
    const duration = centiseconds(until - start) - centiseconds(syllable.t - start);
    return `{\\kf${duration}}${literal(syllable.text)}`;
  });
  return `Dialogue: 0,${assTime(start)},${assTime(line.end)},Lyrics,,0,0,0,,${parts.join("")}`;
}

function telopTime(telop: Telop, cues: Readonly<Record<string, number>>): number {
  if (typeof telop.at === "number") return telop.at;
  const cue = cues[telop.at];
  if (cue === undefined) throw new Error(`Telop "${telop.text}": no cue named "${telop.at}". Cues: ${Object.keys(cues).join(", ") || "(none)"}.`);
  return cue;
}

/** A telop that pops in (grows past full size and settles) and fades out. */
function telopLine(telop: Telop, cues: Readonly<Record<string, number>>): string {
  const at = telopTime(telop, cues);
  const pop = `{\\fad(0,${FADE_OUT_MS})\\fscx70\\fscy70\\t(0,${POP_MS},\\fscx115\\fscy115)\\t(${POP_MS},${2 * POP_MS},\\fscx100\\fscy100)}`;
  return `Dialogue: 1,${assTime(at)},${assTime(at + telop.hold)},Telop,,0,0,0,,${pop}${literal(telop.text)}`;
}

/** The whole ASS file: karaoke lines for the timing map's lyrics, then the telops. */
export function assSubtitles(timing: TimingMap, telops: readonly Telop[], options: CaptionOptions): string {
  const lines = [...(timing.lyrics ?? []).map(karaokeLine), ...telops.map((telop) => telopLine(telop, timing.cues))];
  return `${header(options)}\n${lines.join("\n")}\n`;
}
