// PlayerData: what a player view (the GUI plugin's, the playground's) needs to play a rendered
// jingle and show its timing. Built here, with no Node built-in, so the browser builds the same.
import { MIME_TYPES } from "./audio-format.ts";
import { MIDI_MIME_TYPE, scoreToMidi } from "./midi.ts";
import { scoreToMusicXml } from "./musicxml.ts";
import type { RenderResult } from "./render.ts";
import type { Score } from "./score.ts";
import { tagsOf } from "./tags.ts";
import type { TimingMap } from "./timing.ts";
import { toWav } from "./wav.ts";

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
  /** The score as sheet music (MusicXML), when it was asked for or the score sets a meter, key or pickup, and has pitched notes to show. */
  musicxml?: string;
  /** How the view shows it; absent in results rendered before 0.10 (a view then shows the waveform). */
  presentation?: Presentation;
}

/** How a player view shows the jingle: what the LLM asked for when it rendered it. */
export const VIEWS = ["waveform", "notation"] as const;
export type PlayerView = (typeof VIEWS)[number];

export interface Presentation {
  /** What the view shows first: the waveform with cues and lanes, or the sheet music. */
  view: PlayerView;
  /** Start playing as soon as the view appears (once; never again when the card is shown later). */
  autoplay: boolean;
  /** When playback reaches the end for the first time, the view tells the LLM so it can go on. */
  notifyWhenDone: boolean;
  /** When the render was made (ms since 1970): a view autoplays only a fresh one, never one replayed from history. */
  renderedAt?: number;
}

export const DEFAULT_PRESENTATION: Presentation = { view: "waveform", autoplay: false, notifyWhenDone: false };

/** Sheet music goes with a score written for it, or one the LLM asked to see as sheet music. */
export function wantsNotation(score: Score, view: PlayerView): boolean {
  return view === "notation" || score.meter !== undefined || score.key !== undefined || score.pickup !== undefined;
}

/** The embedded audio: a data URI and its type. */
export interface PlayerAudio {
  audio: string;
  mimeType: string;
}

const PEAK_SLICES = 600;
const BASE64_CHUNK = 0x8000;

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

/** A data URI of `bytes`, base64-encoded with btoa (in browsers and Node alike). */
export function dataUri(mimeType: string, bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) chunks.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK)));
  return `data:${mimeType};base64,${btoa(chunks.join(""))}`;
}

/** The render as a 16-bit WAV data URI, tagged with the score's title, author and copyright. */
export function wavPlayerAudio(result: RenderResult, score: Score): PlayerAudio {
  return { audio: dataUri(MIME_TYPES.wav, toWav(result.audio, result.sampleRate, 16, tagsOf(score))), mimeType: MIME_TYPES.wav };
}

/** One decimal, as loudness is reported to the LLM and in the view. */
export const round1 = (x: number): number => Math.round(x * 10) / 10;

/** PlayerData for a render of `score`, with `audio` embedded (WAV unless the caller encoded something smaller). */
export function toPlayerData(
  score: Score,
  result: RenderResult,
  title: string,
  audio: PlayerAudio = wavPlayerAudio(result, score),
  presentation: Presentation = DEFAULT_PRESENTATION,
): PlayerData {
  const musicxml = wantsNotation(score, presentation.view) ? scoreToMusicXml(score) : undefined;
  return {
    title: score.title ?? title,
    ...audio,
    duration: result.timing.duration,
    peaks: peaksOf(result.audio),
    timing: result.timing,
    tracks: score.tracks.map((t) => t.name ?? t.instrument),
    loudness: round1(result.stats.loudness),
    score,
    midi: dataUri(MIDI_MIME_TYPE, scoreToMidi(score)),
    ...(musicxml === undefined ? {} : { musicxml }),
    // Without sheet music to show, the view shows the waveform whatever was asked.
    presentation: { ...presentation, view: musicxml === undefined ? "waveform" : presentation.view },
  };
}
