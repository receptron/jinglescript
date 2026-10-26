// Singing through NEUTRINO (https://studio-neutrino.com/), a free singing-voice synthesizer the user
// installs themselves. Node only: it runs NEUTRINO's command-line tools with child_process. Nothing
// of NEUTRINO is bundled or downloaded here (its EULA forbids redistribution); its output is
// subject to NEUTRINO's EULA and the voice library's terms (no AI training / voice conversion).
// The NEUTRINO folder is only read: labels, f0, mel and wav are written to a work dir in the cache.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import * as dmath from "../dsp/math.ts";
import { resample } from "../dsp/resample.ts";
import { pitchToMidi } from "../pitch.ts";
import { DEFAULT_SAMPLE_RATE, expandOrThrow, render, setSinger, type RenderOptions } from "../render.ts";
import { defaultCacheDir } from "../samples/load.ts";
import { decodeWavMono } from "../samples/wav-read.ts";
import type { Score } from "../score.ts";
import { toHiragana } from "./kana.ts";
import type { SingerNote } from "./types.ts";

/** NEUTRINO renders at this rate (its default; -s resamples, so we keep it and resample ourselves). */
export const NEUTRINO_SAMPLE_RATE = 48000;
/** MusicXML timing: quarter = 0.5 s (tempo 120), DIVISIONS per quarter, 4/4 measures. */
const TEMPO = 120;
const DIVISIONS = 480;
const MEASURE = DIVISIONS * 4;
/** Gaps shorter than this (0.1 s) between notes are sung through, not breathed (NEUTRINO pauses at every rest). */
const LEGATO_GAP = Math.round((0.1 * DIVISIONS * TEMPO) / 60);
/** A bar of rest before the first note so its consonant can start early; trimmed from the output. */
export const NEUTRINO_LEAD_IN = (MEASURE / DIVISIONS) * (60 / TEMPO);

export interface NeutrinoInstall {
  dir: string;
  /** Voice library folders under model/ (MERROW, REINA, …). */
  voices: string[];
  /** model/<voice>/version_information.txt plus the binary's size and mtime: changes with an update. */
  version: string;
}

export class NeutrinoMissingError extends Error {
  readonly dir: string;
  constructor(dir: string) {
    super(
      `NEUTRINO was not found at ${dir} (it needs bin/neutrino, bin/musicXMLtoLabel and model/). Download it yourself from https://studio-neutrino.com/downloads/ (accept its EULA) and unzip it to ${DEFAULT_NEUTRINO_DIR}, or set its folder with NEUTRINO_DIR=/path/to/NEUTRINO in a .env file in the project directory (or in the environment).`,
    );
    this.name = "NeutrinoMissingError";
    this.dir = dir;
  }
}

export class NeutrinoVoiceMissingError extends Error {
  readonly voice: string;
  readonly installed: readonly string[];
  constructor(voice: string, installed: readonly string[], dir: string) {
    super(
      `The NEUTRINO voice "${voice}" is not installed in ${join(dir, "model")}. Installed: ${installed.join(", ") || "(none)"}. Set "voice" in the track's "sing" to one of them, or add the voice library to NEUTRINO's model folder.`,
    );
    this.name = "NeutrinoVoiceMissingError";
    this.voice = voice;
    this.installed = installed;
  }
}

/** The voice used when a score names none. */
export const DEFAULT_NEUTRINO_VOICE = "REINA";

export const DEFAULT_NEUTRINO_DIR = "/Applications/NEUTRINO";

/**
 * The NEUTRINO folder: NEUTRINO_DIR from the environment, else from `envFile` (.env in the current
 * directory), else DEFAULT_NEUTRINO_DIR. The .env file is only read, never loaded into process.env.
 */
export function neutrinoDir(env: NodeJS.ProcessEnv = process.env, envFile = join(process.cwd(), ".env")): string {
  if (env.NEUTRINO_DIR) return env.NEUTRINO_DIR;
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).NEUTRINO_DIR : undefined;
  return fromFile || DEFAULT_NEUTRINO_DIR;
}

function isInstall(dir: string): boolean {
  return existsSync(join(dir, "bin", "neutrino")) && existsSync(join(dir, "bin", "musicXMLtoLabel")) && existsSync(join(dir, "model"));
}

/** The NEUTRINO install in `dir`, or undefined when it is not one. */
export function findNeutrino(dir: string = neutrinoDir()): NeutrinoInstall | undefined {
  if (!isInstall(dir)) return undefined;
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
  if (found === undefined) throw new NeutrinoVoiceMissingError(voice, install.voices, install.dir);
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

/** How a sung track is rendered; voice and level come from the score's `sing`, the rest from configureNeutrino (tests). */
interface NeutrinoOptions {
  /** A voice under model/ ("reina", "merrow", …; case-insensitive). Default DEFAULT_NEUTRINO_VOICE (REINA); NeutrinoVoiceMissingError when not installed. */
  voice?: string;
  /** Semitones to render the whole part up (NEUTRINO -f). */
  transpose?: number;
  /** Sing as if the key were this many semitones up, pitched back (NEUTRINO -k, about −5…5). */
  styleShift?: number;
  /** CPU threads (NEUTRINO -n); default: all cores. */
  threads?: number;
  /** The NEUTRINO folder (default: neutrinoDir(): NEUTRINO_DIR from the environment or .env, else /Applications/NEUTRINO). */
  dir?: string;
  cacheDir?: string;
  /** Replaces child_process.execFile (tests). */
  exec?: NeutrinoExec;
  /**
   * Loudness of the vocal over the rest of the mix, LU (default VOCAL_LEVEL_DB), measured after the
   * tracks' gain, velocity and reverb; the sung track's `gain` then shifts it. null: NEUTRINO's own level.
   */
  vocalLevel?: number | null;
}

/** Default loudness of a NEUTRINO vocal over its accompaniment, LU. */
export const VOCAL_LEVEL_DB = 4;

/** Runs a NEUTRINO tool; `cwd` is the install (musicXMLtoLabel reads settings/dic relative to it). */
export type NeutrinoExec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => void;

/**
 * Runs synchronously (execFileSync), because render() is sync: the whole process, an MCP server
 * included, blocks while NEUTRINO runs (tens of seconds for an uncached render). Cached renders are instant.
 */
const defaultExec: NeutrinoExec = (file, args, env, cwd) => {
  try {
    execFileSync(file, [...args], { env, cwd, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error && error.stderr instanceof Buffer ? error.stderr.toString() : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file} failed: ${message}\n${stderr.slice(-2000)}`, { cause: error });
  }
};

/** The render cache key: the MusicXML, the voice, the options that change the sound, and the install's version. */
export function neutrinoCacheKey(xml: string, voice: string, options: Pick<NeutrinoOptions, "transpose" | "styleShift">, version: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ xml, voice, transpose: options.transpose ?? 0, styleShift: options.styleShift ?? 0, version, v: 1 }))
    .digest("hex");
}

/** neutrino-renders/ keeps at most this many WAVs (every edit of a sung score adds one); oldest go first. */
export const MAX_CACHED_RENDERS = 200;
/** Cached renders older than this many days are removed. The folder is a cache: safe to delete. */
export const MAX_RENDER_AGE_DAYS = 30;

/** Removes cached renders older than MAX_RENDER_AGE_DAYS, then the oldest beyond MAX_CACHED_RENDERS. */
export function pruneRenders(root: string, now = Date.now(), keep = MAX_CACHED_RENDERS, maxAgeDays = MAX_RENDER_AGE_DAYS): void {
  if (!existsSync(root)) return;
  const files = readdirSync(root)
    .filter((name) => name.endsWith(".wav"))
    .map((name) => ({ path: join(root, name), mtime: statSync(join(root, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.forEach((file, i) => {
    if (i >= keep || now - file.mtime > maxAgeDays * 86_400_000) rmSync(file.path, { force: true });
  });
}

/** NEUTRINO's 48 kHz WAV for a MusicXML, from the cache or by running musicXMLtoLabel and neutrino. */
function neutrinoWav(install: NeutrinoInstall, voice: string, xml: string, options: NeutrinoOptions): { wav: Uint8Array; cached: boolean } {
  const root = join(options.cacheDir ?? defaultCacheDir(), "neutrino-renders");
  const key = neutrinoCacheKey(xml, voice, options, install.version);
  const file = join(root, `${key}.wav`);
  if (existsSync(file)) return { wav: readFileSync(file), cached: true };
  mkdirSync(root, { recursive: true });
  pruneRenders(root);
  const work = mkdtempSync(join(root, "work-"));
  try {
    const exec = options.exec ?? defaultExec;
    const bin = join(install.dir, "bin");
    const env = {
      ...process.env,
      DYLD_LIBRARY_PATH: [bin, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(":"),
      LD_LIBRARY_PATH: [bin, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
    };
    const p = (name: string): string => join(work, name);
    writeFileSync(p("score.musicxml"), xml);
    exec(join(bin, "musicXMLtoLabel"), [p("score.musicxml"), p("full.lab"), p("mono.lab")], env, install.dir);
    const threads = options.threads ?? Math.max(1, cpus().length);
    exec(
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
    const wav = readFileSync(p("out.wav"));
    writeFileSync(file, wav);
    return { wav, cached: false };
  } finally {
    if (!process.env.NEUTRINO_KEEP_WORK) rmSync(work, { recursive: true, force: true });
  }
}

/** Fade-in at the lead-in cut, s: a note at time 0 has its consonant cut there, which would click. */
export const CUT_FADE_SECONDS = 0.005;

/** NEUTRINO's PCM (mono, `sampleRate`, from score time 0: the lead-in removed, faded in at the cut). */
export function alignNeutrinoPcm(data: Float32Array, rate: number, sampleRate: number): Float32Array {
  const skip = Math.round(NEUTRINO_LEAD_IN * rate);
  const body = data.subarray(Math.min(skip, data.length));
  const step = rate / sampleRate;
  const out = rate === sampleRate ? Float32Array.from(body) : resample(body, step, 0.5 / Math.max(1, step), Math.round((body.length * sampleRate) / rate));
  const fade = Math.min(out.length, Math.round(CUT_FADE_SECONDS * sampleRate));
  for (let i = 0; i < fade; i++) out[i] = (out[i] ?? 0) * (i / fade);
  return out;
}

/** The sung notes of one track: onset to onset + hold, first pitch, the lyric ("" when none). */
export function singerNotes(score: Score, track: number): SingerNote[] {
  const notes: SingerNote[] = [];
  for (const event of expandOrThrow(score).events) {
    if (event.track !== track || event.repeat !== 0) continue;
    const midi = pitchToMidi(event.pitches[0] ?? "");
    if (midi === undefined) continue;
    const end = event.seconds + (Number.isFinite(event.hold) ? event.hold : 0.5);
    notes.push({ start: event.seconds, end, midi: midi + event.detune / 100, lyric: event.lyric ?? "" });
  }
  return notes.sort((a, b) => a.start - b.start);
}

/** Mono PCM of `track` sung by NEUTRINO at `sampleRate`, from time 0. */
export function singTrack(
  score: Score,
  track: number,
  options: NeutrinoOptions = {},
  sampleRate = DEFAULT_SAMPLE_RATE,
): { pcm: Float32Array; sampleRate: number; voice: string; cached: boolean } {
  const dir = options.dir ?? neutrinoDir();
  const install = findNeutrino(dir);
  if (install === undefined) throw new NeutrinoMissingError(dir);
  const voice = resolveVoice(install, options.voice ?? score.tracks[track]?.sing?.voice ?? DEFAULT_NEUTRINO_VOICE);
  const xml = neutrinoMusicXml(singerNotes(score, track));
  const { wav, cached } = neutrinoWav(install, voice, xml, options);
  const decoded = decodeWavMono(wav);
  return { pcm: alignNeutrinoPcm(decoded.data, decoded.sampleRate, sampleRate), sampleRate, voice, cached };
}

let configured: NeutrinoOptions = {};
/** Internal (tests): overrides for the NEUTRINO folder, cache, exec and level. Not part of the public API. */
export function configureNeutrino(options: NeutrinoOptions): void {
  configured = options;
}

/** The sung track's vocal for render(): NEUTRINO's PCM scaled to the score's `sing.level` (default VOCAL_LEVEL_DB). */
function neutrinoSinger(score: Score, options: RenderOptions, track: number): Float32Array {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const { pcm } = singTrack(score, track, configured, sampleRate);
  const level = configured.vocalLevel === undefined ? (score.tracks[track]?.sing?.level ?? VOCAL_LEVEL_DB) : configured.vocalLevel;
  const gain = dmath.dbToGain(level === null ? 0 : vocalGainDb(score, track, pcm, { ...options, sampleRate }, level));
  return pcm.map((v) => v * gain);
}

setSinger(neutrinoSinger);
/** Internal (tests): registers NEUTRINO with render() again after setSinger(undefined). */
export function reinstallNeutrino(): void {
  setSinger(neutrinoSinger);
}

/** Pre-master loudness of a render (its loudness less the master's gain), LUFS. */
function premasterLoudness(score: Score, options: RenderOptions, prerendered: Map<number, Float32Array>): number {
  const { stats } = render(score, { ...options, prerendered });
  return stats.loudness - stats.gainDb;
}

/**
 * Note: this renders the whole score twice more (vocal only, then accompaniment only) on top of the
 * final render, so a sung score costs about three renders; fine for jingles, slower for long scores
 * or sampled instruments such as grandpiano. NEUTRINO itself runs once (its PCM is passed in).
 *
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
