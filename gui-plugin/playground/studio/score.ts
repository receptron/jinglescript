// The studio's marks and music style → a JingleScript score. Pure: the page owns the state, this
// decides what the score says. Every mark becomes a cue in seconds, so a sound lands exactly where
// the editor put it, and the music builds up to the mark chosen as the hit.
import type { InstrumentName, ScoreInput } from "jinglescript/browser";

type Note = ScoreInput["tracks"][number]["notes"][number];

export interface SoundDef {
  label: string;
  emoji: string;
  instrument: InstrumentName;
  variant?: string;
  pitch?: string;
  /** Ends on the mark instead of starting there (a whoosh into a cut). */
  lead?: { seconds: number };
  /** A few steps from the mark on (footsteps). */
  steps?: { count: number; every: number };
}

export const SOUNDS = {
  pop: { label: "Pop", emoji: "🫧", instrument: "pop", pitch: "G5" },
  whoosh: { label: "Whoosh", emoji: "💨", instrument: "whoosh", variant: "fast", lead: { seconds: 0.5 } },
  riser: { label: "Build-up", emoji: "📈", instrument: "riser", variant: "noise", lead: { seconds: 2 } },
  impact: { label: "Boom", emoji: "💥", instrument: "impact", variant: "hard" },
  ding: { label: "Ding", emoji: "🔔", instrument: "ding" },
  clang: { label: "Clang", emoji: "🍳", instrument: "metal" },
  glass: { label: "Clink", emoji: "🥂", instrument: "glass" },
  punch: { label: "Punch", emoji: "👊", instrument: "punch", variant: "hit" },
  knock: { label: "Knock", emoji: "🚪", instrument: "knock", variant: "door" },
  steps: { label: "Footsteps", emoji: "👣", instrument: "footsteps", variant: "carpet", steps: { count: 4, every: 0.4 } },
  clap: { label: "Applause", emoji: "👏", instrument: "clap", variant: "group" },
  laser: { label: "Zap", emoji: "⚡", instrument: "laser", pitch: "C7" },
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
export const SOUND_IDS = Object.keys(SOUNDS).filter((id): id is SoundId => id in SOUNDS);

interface StyleDef {
  label: string;
  emoji: string;
  instrument: InstrumentName;
  tempo: number;
  /** Notes leading into the hit, in beats before it (4 = four beats early). */
  lead: readonly (readonly [beatsBefore: number, pitch: string])[];
  chord: readonly string[];
  bass: string;
}

export const STYLES = {
  marimba: {
    label: "Friendly marimba",
    emoji: "🪵",
    instrument: "marimba",
    tempo: 120,
    lead: [
      [4, "C5"],
      [3, "E5"],
      [2, "G5"],
      [1, "B5"],
    ],
    chord: ["C5", "E5", "G5", "C6"],
    bass: "C3",
  },
  xylophone: {
    label: "Cartoon xylophone",
    emoji: "🎮",
    instrument: "xylophone",
    tempo: 132,
    lead: [
      [3, "G5"],
      [2.5, "A5"],
      [2, "B5"],
      [1, "D6"],
      [0.5, "F#6"],
    ],
    chord: ["G5", "B5", "D6", "G6"],
    bass: "G3",
  },
  piano: {
    label: "Warm piano",
    emoji: "🎹",
    instrument: "piano",
    tempo: 96,
    lead: [
      [4, "E4"],
      [3, "G4"],
      [2, "C5"],
      [1, "D5"],
    ],
    chord: ["C4", "E4", "G4", "E5"],
    bass: "C2",
  },
  ukulele: {
    label: "Sunny ukulele",
    emoji: "🏝️",
    instrument: "ukulele",
    tempo: 112,
    lead: [
      [4, "C4"],
      [3, "E4"],
      [2, "G4"],
      [1, "A4"],
    ],
    chord: ["C4", "E4", "G4", "C5"],
    bass: "C3",
  },
  musicbox: {
    label: "Music box",
    emoji: "🎁",
    instrument: "musicbox",
    tempo: 92,
    lead: [
      [4, "C6"],
      [3, "G5"],
      [2, "E5"],
      [1, "G5"],
    ],
    chord: ["C5", "E5", "G5", "C6"],
    bass: "C4",
  },
} as const satisfies Record<string, StyleDef>;

export type StyleId = keyof typeof STYLES;
export const STYLE_IDS = Object.keys(STYLES).filter((id): id is StyleId => id in STYLES);

export interface Mark {
  id: string;
  /** Seconds into the video. */
  t: number;
  sound: SoundId;
}

export interface StudioInput {
  /** The video's length in seconds. */
  duration: number;
  marks: readonly Mark[];
  style: StyleId | "none";
  /** The mark the music lands on; without one, a short jingle plays from the start. */
  hitMarkId?: string;
}

export const MIN_SECONDS = 1;
export const MAX_SECONDS = 60;
/** Nothing starts closer to the end than this: the render needs room for it to sound. */
const END_MARGIN_SECONDS = 0.05;
const JINGLE_HIT_BEATS = 4;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const SAFE_CUE = /[^a-z0-9]/gi;
const cueOf = (mark: Mark): string => `m_${mark.id.replace(SAFE_CUE, "")}`;

function soundNotes(sound: SoundDef, mark: Mark, cue: string, length: number): Note[] {
  const base = { ...(sound.variant === undefined ? {} : { variant: sound.variant }), ...(sound.pitch === undefined ? {} : { pitch: sound.pitch }) };
  if (sound.lead !== undefined && mark.t > 0.1) return [{ ...base, end: cue, len: { seconds: round3(Math.min(sound.lead.seconds, mark.t)) } }];
  if (sound.steps !== undefined) {
    const { count, every } = sound.steps;
    return Array.from({ length: count }, (_, i) => round3(mark.t + i * every))
      .filter((t) => t < length - END_MARGIN_SECONDS)
      .map((t, i) => ({ ...base, at: { seconds: t }, vel: round3(0.9 - i * 0.1) }));
  }
  return [{ ...base, at: cue }];
}

function musicTrack(styleId: StyleId, hitSeconds: number | undefined, length: number): ScoreInput["tracks"][number] {
  const style: StyleDef = STYLES[styleId];
  const beat = 60 / style.tempo;
  const hit = hitSeconds ?? Math.min(JINGLE_HIT_BEATS * beat, length / 2);
  const notes: Note[] = style.lead
    .map(([before, pitch]) => ({ t: round3(hit - before * beat), pitch }))
    .filter(({ t }) => t >= 0)
    .map(({ t, pitch }) => ({ at: { seconds: t }, pitch, vel: 0.7 }));
  notes.push({ at: { seconds: round3(hit) }, pitch: [...style.chord], vel: 1 }, { at: { seconds: round3(hit) }, pitch: style.bass, vel: 0.9 });
  return { instrument: style.instrument, name: "music", gain: -3, notes };
}

/** The score for the studio's state. Marks outside the video are left out. */
export function studioScore(input: StudioInput): ScoreInput {
  const length = round3(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, input.duration)));
  const marks = input.marks.filter((mark) => mark.t >= 0 && mark.t < length - END_MARGIN_SECONDS);
  const cues = Object.fromEntries(marks.map((mark) => [cueOf(mark), { seconds: round3(mark.t) }]));
  const bySound = new Map<SoundId, Note[]>();
  for (const mark of marks) bySound.set(mark.sound, [...(bySound.get(mark.sound) ?? []), ...soundNotes(SOUNDS[mark.sound], mark, cueOf(mark), length)]);
  const sfx = [...bySound].filter(([, notes]) => notes.length > 0).map(([id, notes]) => ({ instrument: SOUNDS[id].instrument, name: id, notes }));
  const hit = marks.find((mark) => mark.id === input.hitMarkId);
  const tempo = input.style === "none" ? 120 : STYLES[input.style].tempo;
  return {
    format: "jinglescript/1",
    title: "Studio",
    tempo,
    length: { seconds: length },
    seed: 1,
    cues,
    tracks: [...(input.style === "none" ? [] : [musicTrack(input.style, hit === undefined ? undefined : round3(hit.t), length)]), ...sfx],
  };
}

/**
 * A row per mark for drawing them on the timeline, so marks close together stack instead of hiding
 * each other: a mark goes in the first row whose last mark is at least `gap` (a fraction of the
 * duration) earlier.
 */
export function markRows(marks: readonly Mark[], duration: number, gap: number): Map<string, number> {
  const rowEnds: number[] = [];
  const rows = new Map<string, number>();
  for (const mark of [...marks].sort((a, b) => a.t - b.t)) {
    const position = mark.t / Math.max(duration, Number.EPSILON);
    const free = rowEnds.findIndex((end) => position - end >= gap);
    const row = free === -1 ? rowEnds.length : free;
    rowEnds[row] = position;
    rows.set(mark.id, row);
  }
  return rows;
}
