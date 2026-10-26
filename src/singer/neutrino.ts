// Singing through NEUTRINO (https://studio-neutrino.com/), a free singing-voice synthesizer the user
// installs themselves. Node only: it runs NEUTRINO's command-line tools with child_process. Nothing
// of NEUTRINO is bundled or downloaded here (its EULA forbids redistribution); its output is
// subject to NEUTRINO's EULA and the voice library's terms (no AI training / voice conversion).
// The NEUTRINO folder is only read: labels, f0, mel and wav are written to a work dir in the cache.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, cpus } from "node:os";
import { join } from "node:path";
import * as dmath from "../dsp/math.ts";
import { resample } from "../dsp/resample.ts";
import { DEFAULT_SAMPLE_RATE, render, type RenderOptions, type RenderResult } from "../render.ts";
import { defaultCacheDir } from "../samples/load.ts";
import { decodeWavMono } from "../samples/wav-read.ts";
import type { Score } from "../score.ts";
import { singerNotes, renderWithSinger } from "./sing.ts";
import { toHiragana } from "./kana.ts";
import type { SingerNote } from "./types.ts";

/** NEUTRINO renders at this rate (its default; -s resamples, so we keep it and resample ourselves). */
export const NEUTRINO_SAMPLE_RATE = 48000;
/** MusicXML timing: quarter = 0.5 s (tempo 120), DIVISIONS per quarter, 4/4 measures. */
const TEMPO = 120;
const DIVISIONS = 480;
const MEASURE = DIVISIONS * 4;
/** A bar of rest before the first note so its consonant can start early; trimmed from the output. */
/** Gaps shorter than this (0.1 s) between notes are sung through, not breathed (NEUTRINO pauses at every rest). */
const LEGATO_GAP = Math.round((0.1 * DIVISIONS * TEMPO) / 60);
export const NEUTRINO_LEAD_IN = (MEASURE / DIVISIONS) * (60 / TEMPO);

export interface NeutrinoInstall {
  dir: string;
  /** Voice library folders under model/ (MERROW, REINA, …). */
  voices: string[];
  /** model/<voice>/version_information.txt plus the binary's size and mtime: changes with an update. */
  version: string;
}

export class NeutrinoMissingError extends Error {
  constructor(tried: readonly string[]) {
    super(
      `NEUTRINO is not installed. Download it yourself from https://studio-neutrino.com/downloads/ (accept its EULA), unzip it, and put the NEUTRINO folder in /Applications or set NEUTRINO_DIR. Looked in: ${tried.join(", ")}`,
    );
    this.name = "NeutrinoMissingError";
  }
}

export class NeutrinoVoiceError extends Error {
  constructor(voice: string, voices: readonly string[]) {
    super(`NEUTRINO has no voice "${voice}". Installed: ${voices.join(", ") || "(none)"}`);
    this.name = "NeutrinoVoiceError";
  }
}

/** Where to look, in order: NEUTRINO_DIR, /Applications/NEUTRINO, <cache>/neutrino. */
export function neutrinoCandidates(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const cache = env.JINGLESCRIPT_CACHE ?? join(env.XDG_CACHE_HOME || join(home, ".cache"), "jinglescript");
  return [...(env.NEUTRINO_DIR ? [env.NEUTRINO_DIR] : []), "/Applications/NEUTRINO", join(cache, "neutrino")];
}

function isInstall(dir: string): boolean {
  return existsSync(join(dir, "bin", "neutrino")) && existsSync(join(dir, "bin", "musicXMLtoLabel")) && existsSync(join(dir, "model"));
}

/** The first NEUTRINO install found, or undefined. */
export function findNeutrino(candidates: readonly string[] = neutrinoCandidates()): NeutrinoInstall | undefined {
  const dir = candidates.find(isInstall);
  if (dir === undefined) return undefined;
  const voices = readdirSync(join(dir, "model"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, "model", entry.name, "info.toml")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const bin = statSync(join(dir, "bin", "neutrino"));
  const infos = voices.map((voice) => {
    const file = join(dir, "model", voice, "version_information.txt");
    return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  });
  return { dir, voices, version: `${bin.size}:${Math.round(bin.mtimeMs)}:${createHash("sha256").update(infos.join("\n")).digest("hex").slice(0, 16)}` };
}

/** The install's folder name for a voice given case-insensitively ("reina" → "REINA"). */
export function resolveVoice(install: NeutrinoInstall, voice: string): string {
  const found = install.voices.find((name) => name.toLowerCase() === voice.toLowerCase());
  if (found === undefined) throw new NeutrinoVoiceError(voice, install.voices);
  return found;
}

const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"] as const;
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] as const;
const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "ー"/"_"/"" after a sung note hold its vowel (NEUTRINO's "ー"); kana are passed as hiragana. */
function neutrinoLyric(lyric: string): string {
  const text = toHiragana(lyric.trim());
  return text === "_" || text === "" ? "ー" : text;
}

interface Piece {
  dur: number;
  midi?: number;
  lyric?: string;
  /** "stop" ties from the previous part, "start" to the next. */
  ties?: ("stop" | "start")[];
}

const toDiv = (seconds: number): number => Math.round((seconds * DIVISIONS * TEMPO) / 60) + MEASURE;

/** Notes and rests back to back from division 0 (the lead-in bar first), filling whole bars. */
function timelineOf(notes: readonly SingerNote[]): Piece[] {
  const timeline: Piece[] = [];
  let cursor = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  sorted.forEach((note, i) => {
    const start = toDiv(note.start);
    const next = sorted[i + 1];
    const end = Math.min(toDiv(note.end), next === undefined ? Infinity : toDiv(next.start));
    if (end <= start || end <= cursor) return;
    const from = Math.max(start, cursor);
    const previous = timeline.at(-1);
    if (from > cursor && from - cursor < LEGATO_GAP && previous?.midi !== undefined) previous.dur += from - cursor;
    else if (from > cursor) timeline.push({ dur: from - cursor });
    const lyric = note.lyric.trim();
    const sung = lyric !== "" || timeline.at(-1)?.midi !== undefined;
    timeline.push(sung ? { dur: end - from, midi: Math.round(note.midi), lyric: neutrinoLyric(lyric) } : { dur: end - from });
    cursor = end;
  });
  const total = Math.max(2, Math.ceil((cursor + 1) / MEASURE)) * MEASURE;
  timeline.push({ dur: total - cursor });
  return timeline;
}

/** One piece starting at division `at`, cut at barlines: tied parts, the lyric on the first. */
function cutAtBars(piece: Piece, at: number): Piece[] {
  const parts: Piece[] = [];
  let position = at;
  const end = at + piece.dur;
  while (position < end) {
    const take = Math.min(end, (Math.floor(position / MEASURE) + 1) * MEASURE) - position;
    const ties: ("stop" | "start")[] = [];
    if (piece.midi !== undefined && position > at) ties.push("stop");
    if (piece.midi !== undefined && position + take < end) ties.push("start");
    parts.push({ ...piece, dur: take, ties, lyric: position === at ? piece.lyric : undefined });
    position += take;
  }
  return parts;
}

/** The pieces cut at barlines, as one list of notes per bar. */
function measuresOf(timeline: readonly Piece[]): Piece[][] {
  const measures: Piece[][] = [];
  let at = 0;
  for (const piece of timeline) {
    for (const part of cutAtBars(piece, at)) {
      const bar = Math.floor(at / MEASURE);
      if (measures[bar] === undefined) measures[bar] = [];
      measures[bar].push(part);
      at += part.dur;
    }
  }
  return measures;
}

const FIRST_BAR_HEAD =
  `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
  `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${TEMPO}</per-minute></metronome></direction-type><sound tempo="${TEMPO}"/></direction>`;

/**
 * The sung notes as MusicXML for NEUTRINO's musicXMLtoLabel: one part, 4/4 at tempo 120 so score
 * seconds map linearly (0.5 s per quarter), a lead-in bar of rest, gaps as rests (under 0.1 s:
 * legato), notes over a barline split and tied, overlapping notes cut at the next onset.
 * Microtonal detune is rounded.
 */
export function neutrinoMusicXml(notes: readonly SingerNote[]): string {
  const body = measuresOf(timelineOf(notes))
    .map((items, i) => `<measure number="${i + 1}">${i === 0 ? FIRST_BAR_HEAD : ""}\n${items.map(noteXml).join("\n")}\n</measure>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
<part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
<part id="P1">
${body}
</part>
</score-partwise>
`;
}

function noteXml(piece: Piece): string {
  if (piece.midi === undefined) return `<note><rest/><duration>${piece.dur}</duration></note>`;
  const pc = ((piece.midi % 12) + 12) % 12;
  const octave = Math.floor(piece.midi / 12) - 1;
  const alter = ALTERS[pc] ? "<alter>1</alter>" : "";
  const ties = piece.ties ?? [];
  const tieXml = ties.map((t) => '<tie type="' + t + '"/>').join("");
  const tiedXml = ties.map((t) => '<tied type="' + t + '"/>').join("");
  const tied = ties.length === 0 ? "" : `<notations>${tiedXml}</notations>`;
  const text = escapeXml(piece.lyric ?? "");
  const lyric = piece.lyric === undefined ? "" : `<lyric number="1"><syllabic>single</syllabic><text>${text}</text></lyric>`;
  return `<note><pitch><step>${STEPS[pc]}</step>${alter}<octave>${octave}</octave></pitch><duration>${piece.dur}</duration>${tieXml}<voice>1</voice>${tied}${lyric}</note>`;
}

export interface NeutrinoOptions {
  /** Index of the track to sing (its notes' `lyric`s, in kana, are the words). */
  track: number;
  /** A voice under model/ ("reina", "merrow", …; case-insensitive). Default "REINA" when installed, else the first. */
  voice?: string;
  /** Semitones to render the whole part up (NEUTRINO -f). */
  transpose?: number;
  /** Sing as if the key were this many semitones up, pitched back (NEUTRINO -k, about −5…5). */
  styleShift?: number;
  /** CPU threads (NEUTRINO -n); default: all cores. */
  threads?: number;
  /** NEUTRINO folders to try (default: neutrinoCandidates()). */
  candidates?: readonly string[];
  cacheDir?: string;
  /** Built-in singer model to use, with a warning, when NEUTRINO is not installed; none: throw. */
  fallbackModel?: string;
  /** Replaces child_process.execFile (tests). */
  exec?: NeutrinoExec;
  warn?: (message: string) => void;
  /**
   * Loudness of the vocal over the rest of the mix, LU (default VOCAL_LEVEL_DB), measured after the
   * tracks' gain, velocity and reverb; the sung track's `gain` then shifts it. null: NEUTRINO's own level.
   */
  vocalLevel?: number | null;
}

/** Default loudness of a NEUTRINO vocal over its accompaniment, LU. */
export const VOCAL_LEVEL_DB = 4;

/** Runs a NEUTRINO tool; `cwd` is the install (musicXMLtoLabel reads settings/dic relative to it). */
export type NeutrinoExec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => Promise<void>;

const defaultExec: NeutrinoExec = (file, args, env, cwd) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { env, cwd, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${file} failed: ${error.message}\n${String(stderr).slice(-2000)}`));
      else resolve();
    });
  });

/** The render cache key: the MusicXML, the voice, the options that change the sound, and the install's version. */
export function neutrinoCacheKey(xml: string, voice: string, options: Pick<NeutrinoOptions, "transpose" | "styleShift">, version: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ xml, voice, transpose: options.transpose ?? 0, styleShift: options.styleShift ?? 0, version, v: 1 }))
    .digest("hex");
}

/** NEUTRINO's 48 kHz WAV for a MusicXML, from the cache or by running musicXMLtoLabel and neutrino. */
async function neutrinoWav(install: NeutrinoInstall, voice: string, xml: string, options: NeutrinoOptions): Promise<{ wav: Uint8Array; cached: boolean }> {
  const root = join(options.cacheDir ?? defaultCacheDir(), "neutrino-renders");
  const key = neutrinoCacheKey(xml, voice, options, install.version);
  const file = join(root, `${key}.wav`);
  if (existsSync(file)) return { wav: await readFile(file), cached: true };
  await mkdir(root, { recursive: true });
  const work = await mkdtemp(join(root, "work-"));
  try {
    const exec = options.exec ?? defaultExec;
    const bin = join(install.dir, "bin");
    const env = {
      ...process.env,
      DYLD_LIBRARY_PATH: [bin, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(":"),
      LD_LIBRARY_PATH: [bin, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
    };
    const p = (name: string): string => join(work, name);
    await writeFile(p("score.musicxml"), xml);
    await exec(join(bin, "musicXMLtoLabel"), [p("score.musicxml"), p("full.lab"), p("mono.lab")], env, install.dir);
    const threads = options.threads ?? Math.max(1, cpus().length);
    await exec(
      join(bin, "neutrino"),
      [
        p("full.lab"),
        p("timing.lab"),
        p("out.f0"),
        p("out.melspec"),
        p("out.wav"),
        join(install.dir, "model", voice) + "/",
        "-n",
        String(threads),
        "-k",
        String(Math.round(options.styleShift ?? 0)),
        "-f",
        String(Math.round(options.transpose ?? 0)),
        "-s",
        String(NEUTRINO_SAMPLE_RATE),
        "-b",
        "16",
      ],
      env,
      install.dir,
    );
    const wav = await readFile(p("out.wav"));
    await writeFile(file, wav);
    return { wav, cached: false };
  } finally {
    if (!process.env.NEUTRINO_KEEP_WORK) await rm(work, { recursive: true, force: true });
  }
}

/** NEUTRINO's PCM (mono, `sampleRate`, from score time 0: the lead-in removed). */
export function alignNeutrinoPcm(data: Float32Array, rate: number, sampleRate: number): Float32Array {
  const skip = Math.round(NEUTRINO_LEAD_IN * rate);
  const body = data.subarray(Math.min(skip, data.length));
  if (rate === sampleRate) return Float32Array.from(body);
  const step = rate / sampleRate;
  return resample(body, step, 0.5 / Math.max(1, step), Math.round((body.length * sampleRate) / rate));
}

/** Mono PCM of the track sung by NEUTRINO at `sampleRate`, from time 0. */
export async function singTrackNeutrino(
  score: Score,
  options: NeutrinoOptions,
  sampleRate = DEFAULT_SAMPLE_RATE,
): Promise<{ pcm: Float32Array; sampleRate: number; voice: string; cached: boolean }> {
  const install = findNeutrino(options.candidates ?? neutrinoCandidates());
  if (install === undefined) throw new NeutrinoMissingError(options.candidates ?? neutrinoCandidates());
  const voice = resolveVoice(install, options.voice ?? (install.voices.includes("REINA") ? "REINA" : (install.voices[0] ?? "REINA")));
  const notes = singerNotes(score, options.track);
  const xml = neutrinoMusicXml(notes);
  const { wav, cached } = await neutrinoWav(install, voice, xml, options);
  const decoded = decodeWavMono(wav);
  return { pcm: alignNeutrinoPcm(decoded.data, decoded.sampleRate, sampleRate), sampleRate, voice, cached };
}

/**
 * render(), with one track sung by the user's NEUTRINO. Without NEUTRINO it warns and sings with
 * `fallbackModel` (the built-in singer) when given, else throws NeutrinoMissingError.
 */
export async function renderWithNeutrino(score: Score, sing: NeutrinoOptions, options: RenderOptions = {}): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const candidates = sing.candidates ?? neutrinoCandidates();
  if (findNeutrino(candidates) === undefined) {
    if (sing.fallbackModel === undefined) throw new NeutrinoMissingError(candidates);
    (sing.warn ?? console.warn)(`NEUTRINO not found; singing track ${sing.track} with the built-in model "${sing.fallbackModel}".`);
    return renderWithSinger(score, { track: sing.track, model: sing.fallbackModel, cacheDir: sing.cacheDir }, options);
  }
  const { pcm } = await singTrackNeutrino(score, { ...sing, candidates }, sampleRate);
  const level = sing.vocalLevel === undefined ? VOCAL_LEVEL_DB : sing.vocalLevel;
  const gainDb = level === null ? 0 : vocalGainDb(score, sing.track, pcm, { ...options, sampleRate }, level);
  const gain = dmath.dbToGain(gainDb);
  return render(score, { ...options, sampleRate, prerendered: new Map([[sing.track, pcm.map((v) => v * gain)]]) });
}

/** Pre-master loudness of a render (its loudness less the master's gain), LUFS. */
function premasterLoudness(score: Score, options: RenderOptions, prerendered: Map<number, Float32Array>): number {
  const { stats } = render(score, { ...options, prerendered });
  return stats.loudness - stats.gainDb;
}

/**
 * dB to scale the vocal `pcm` of `track` by so it sits `level` LU over the other tracks (plus the
 * track's own gain); 0 when either side is silent.
 */
export function vocalGainDb(score: Score, track: number, pcm: Float32Array, options: RenderOptions, level: number): number {
  const silence = new Float32Array(pcm.length);
  const others = new Map(score.tracks.map((_, i) => [i, i === track ? pcm : silence] as const));
  const vocal = premasterLoudness(score, options, others);
  const accompaniment = premasterLoudness(score, options, new Map([[track, silence]]));
  if (!Number.isFinite(vocal) || !Number.isFinite(accompaniment) || score.tracks.length < 2) return 0;
  return accompaniment + level + (score.tracks[track]?.gain ?? 0) - vocal;
}
