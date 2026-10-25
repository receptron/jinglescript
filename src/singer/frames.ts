// Notes → the frame timeline the models read: which phoneme sounds in each frame, and a baseline F0
// that steps to each note's pitch with a short glide. This rule-based timing is what renders when no
// pitch/duration model is installed, and the input a PrettyPitch-style model refines. Pure and
// deterministic: only +−×÷ and the pitch table, no Math.pow/exp (CLAUDE.md).
import { midiToFrequency } from "../pitch.ts";
import { isVoiced, moraPhonemes } from "./kana.ts";
import type { PhonemeSpan, SingerFrames, SingerNote } from "./types.ts";

export const DEFAULT_HOP = 256 / 44100;

export interface FrameOptions {
  /** Seconds per frame. Default 256 samples at 44.1 kHz, as in VocaTab. */
  hop?: number;
  /** Longest consonant, seconds. A consonant takes at most 40 % of its note. */
  consonant?: number;
  /** Glide between two notes' pitches, seconds. */
  glide?: number;
}

export class SingerLyricError extends Error {
  readonly note: number;
  readonly lyric: string;
  constructor(note: number, lyric: string) {
    super(`Note ${note}: "${lyric}" is not one Japanese mora. Write one kana per note (か, きゃ, ん, っ), "ー" or "_" to hold the vowel, or "" for a rest.`);
    this.name = "SingerLyricError";
    this.note = note;
    this.lyric = lyric;
  }
}

const HOLD = new Set(["ー", "_"]);

function phonemesOf(notes: readonly SingerNote[]): (readonly string[])[] {
  let lastVowel = "pau";
  return notes.map((note, i) => {
    if (note.lyric === "") return ["pau"];
    if (HOLD.has(note.lyric)) return [lastVowel];
    const phonemes = moraPhonemes(note.lyric);
    if (phonemes === undefined) throw new SingerLyricError(i, note.lyric);
    lastVowel = phonemes[phonemes.length - 1] ?? lastVowel;
    return phonemes;
  });
}

/** Lays the notes out as frames: phoneme spans (rests between notes become "pau") and baseline F0. */
export function notesToFrames(notes: readonly SingerNote[], options: FrameOptions = {}): SingerFrames {
  const hop = options.hop ?? DEFAULT_HOP;
  const consonantMax = options.consonant ?? 0.06;
  const glideFrames = Math.max(1, Math.round((options.glide ?? 0.05) / hop));
  const frameOf = (seconds: number) => Math.max(0, Math.round(seconds / hop));
  const total = notes.reduce((end, note) => Math.max(end, frameOf(note.end)), 0);
  const phonemes: PhonemeSpan[] = [];
  const midi = new Float64Array(total).fill(Number.NaN);
  const voiced = new Uint8Array(total);
  let cursor = 0;
  const push = (phoneme: string, start: number, end: number, note: number) => {
    if (end > start) phonemes.push({ phoneme, start, end, note });
  };

  phonemesOf(notes).forEach((parts, i) => {
    const note = notes[i];
    if (note === undefined) return;
    const start = Math.max(cursor, frameOf(note.start));
    const end = Math.max(start, frameOf(note.end));
    push("pau", cursor, start, i);
    const consonants = parts.slice(0, -1);
    const vowel = parts[parts.length - 1] ?? "pau";
    const each = consonants.length === 0 ? 0 : Math.min(Math.round(consonantMax / hop), Math.floor(((end - start) * 0.4) / consonants.length));
    let at = start;
    for (const consonant of consonants) {
      push(consonant, at, at + each, i);
      at += each;
    }
    push(vowel, at, end, i);
    for (let f = start; f < end; f++) {
      midi[f] = note.midi;
      const span = f < at ? consonants[Math.min(consonants.length - 1, Math.floor((f - start) / Math.max(1, each)))] : vowel;
      voiced[f] = span !== undefined && span !== "pau" && isVoiced(span) ? 1 : 0;
    }
    cursor = end;
  });

  return { hop, phonemes, f0: baselineF0(midi, voiced, glideFrames) };
}

// Linear glide in semitones over `glide` frames into each new pitch; unvoiced frames get 0 Hz.
function baselineF0(midi: Float64Array, voiced: Uint8Array, glide: number): Float32Array {
  const f0 = new Float32Array(midi.length);
  let previous = Number.NaN;
  let target = Number.NaN;
  let from = Number.NaN;
  let since = 0;
  for (let f = 0; f < midi.length; f++) {
    const m = midi[f] ?? Number.NaN;
    if (Number.isNaN(m)) {
      previous = Number.NaN;
      continue;
    }
    if (m !== target) {
      from = Number.isNaN(previous) ? m : previous;
      target = m;
      since = 0;
    }
    const pitch = since >= glide ? target : from + ((target - from) * since) / glide;
    since++;
    previous = pitch;
    if (voiced[f] === 1) f0[f] = midiToFrequency(pitch);
  }
  return f0;
}
