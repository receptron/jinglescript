// The jinglescript/1 score format, structurally. These zod schemas are the single source of truth:
// the TypeScript types are inferred from them and the published JSON Schema is generated from them.
// Descriptions are written for an LLM reader — they are part of the prompt.
// Checks that need the whole score (cues exist, pitches in range, notes before the end) are added
// in score.ts.
import { z } from "zod";
import { REVERBS } from "./dsp/reverb.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS } from "./instruments/index.ts";
import { PITCH_PATTERN } from "./pitch.ts";
import { CUE_NAME_PATTERN, CUE_REF_PATTERN } from "./time.ts";

export const FORMAT = "jinglescript/1";

const instrumentList = INSTRUMENT_NAMES.map((name) => `"${name}"`).join(", ");
const instrumentHelp = INSTRUMENT_NAMES.map((name) => `${name}: ${INSTRUMENTS[name].descriptor.description}`).join(" | ");

export const SecondsSchema = z
  .strictObject({ seconds: z.number().min(0).describe("Seconds from the start of the jingle.") })
  .describe('A time in seconds, for times the animation fixes ("lands at 1.5 s").');

const BeatsSchema = z.strictObject({
  beats: z.number().min(0).describe("Beats (quarter notes at `tempo`) from the start."),
});

export const CueSchema = z
  .union([SecondsSchema, BeatsSchema], { error: 'A cue is { "seconds": n } or { "beats": n }.' })
  .describe(
    'A named moment the animation syncs to, e.g. { "seconds": 1.5 } for a hit. Give it in seconds when the animation fixes the time, so you never convert seconds to beats yourself. A cue needs no note on it (e.g. where a voice-over starts).',
  );

const AT_HELP = 'Use a number of beats (1.5), { "seconds": 0.86 }, a cue name ("hit"), or a cue name with an offset in beats ("hit+1", "hit-0.25").';

export const AtSchema = z
  .union([z.number().min(0, { error: AT_HELP }), SecondsSchema, z.string().regex(CUE_REF_PATTERN, { error: AT_HELP })], { error: AT_HELP })
  .describe(
    'When the note starts: a number of beats from the start (0, 0.5, 1 …); or { "seconds": n }; or a cue name ("hit"); or a cue name with an offset in beats ("hit+1" = one beat after the cue, "hit-0.5" = half a beat before).',
  );

export const PitchSchema = z
  .string()
  .regex(PITCH_PATTERN, { error: 'A pitch is a note name with an octave: "C4" (middle C), "F#3", "Bb5".' })
  .describe('Scientific pitch notation: "C4" is middle C, "A4" is 440 Hz; sharps "F#3", flats "Bb5".');

export const RepeatSchema = z
  .strictObject({
    every: z.number().positive().describe("Beats between repetitions (1 = every beat, 0.5 = every eighth note)."),
    count: z.int().min(1).max(256).optional().describe("How many times the note sounds in total, including the first."),
    until: AtSchema.optional().describe("Repeat up to and including this time (any `at` form, e.g. a cue). Give `count` or `until`, not both."),
  })
  .refine((r) => (r.count === undefined) !== (r.until === undefined), { error: "Give exactly one of `count` or `until`." })
  .describe("Play the same note repeatedly, e.g. a clock ticking or claps on every beat. Each repetition is its own note in the timing map.");

export const NoteSchema = z
  .strictObject({
    at: AtSchema,
    pitch: z
      .union([PitchSchema, z.array(PitchSchema).min(1)], { error: 'A pitch is "C4", or a list of pitches for a chord: ["C4", "E4", "G4"].' })
      .optional()
      .describe("A pitch, or a list of pitches for a chord. Required for pitched instruments; leave it out for unpitched ones."),
    vel: z.number().min(0).max(1).default(0.8).describe("Velocity 0–1: how hard the note is played (0.8 normal, 1 the big hit, 0.35 a soft echo)."),
    len: z.number().positive().optional().describe("Length in beats for sustained instruments. Struck and plucked instruments ring out and ignore it."),
    pan: z.number().min(0).max(1).optional().describe("Overrides the track's pan for this note: 0 left, 0.5 centre, 1 right."),
    variant: z
      .union([z.string(), z.array(z.string()).min(1)])
      .optional()
      .describe('For sounds with variants (listed per instrument). A list cycles over `repeat`s, e.g. ["left", "right"].'),
    repeat: RepeatSchema.optional(),
    detune: z.number().min(-100).max(100).optional().describe("Cents (1/100 semitone) to detune this note by."),
    humanize: z.number().min(0).max(50).optional().describe("Up to this many ms of seeded random timing offset. Never moves a note placed exactly on a cue."),
  })
  .describe("One note or chord (or one sound effect hit).");

export const TrackSchema = z
  .strictObject({
    instrument: z
      .enum(INSTRUMENT_NAMES, { error: `Unknown instrument. Available: ${instrumentList}.` })
      .describe(`Which built-in instrument or sound effect plays this track. ${instrumentHelp}`),
    name: z.string().optional().describe('Optional label for people, e.g. "melody" or "bass".'),
    gain: z.number().min(-60).max(12).default(0).describe("Track level in dB (0 = as is, -6 = about half as loud)."),
    pan: z.number().min(0).max(1).default(0.5).describe("0 left, 0.5 centre, 1 right."),
    notes: z.array(NoteSchema).min(1).describe("The notes, in any order."),
  })
  .describe("One instrument's part. Use several tracks for several instruments, or for melody and bass on the same instrument.");

export const LengthSchema = z
  .union([SecondsSchema, BeatsSchema], { error: 'length is { "seconds": n } or { "beats": n }.' })
  .describe("Total length of the audio. Leave room after the last note for it to ring out (and for a voice-over, if any).");

export const MasterSchema = z
  .strictObject({
    reverb: z.enum(REVERBS).default("room").describe('"room" (default, small and natural), "hall" (bigger), or "none".'),
    loudness: z.number().min(-30).max(-6).default(-14).describe("Target integrated loudness in LUFS. -14 matches YouTube; leave the default unless asked."),
    fadeOut: z.number().min(0).max(5).default(0.4).describe("Seconds of fade at the very end."),
    limiter: z
      .boolean()
      .default(true)
      .describe("Allow a few dB of transparent peak limiting so the jingle reaches the loudness target. Leave it on unless asked."),
  })
  .describe("Mix settings for the whole jingle.");

export const ScoreBaseSchema = z
  .strictObject({
    $schema: z.string().optional().describe("Optional URL or path of this JSON Schema, for editors."),
    format: z.literal(FORMAT, { error: `format must be "${FORMAT}".` }).describe(`Always "${FORMAT}".`),
    title: z.string().optional(),
    tempo: z.number().min(20).max(400).describe("Beats per minute; one beat is a quarter note. 100–140 suits most jingles."),
    length: LengthSchema,
    seed: z.int().min(0).default(1).describe("Seed for every random detail (mallet noise, reverb, humanize). Same score + seed = identical audio."),
    master: MasterSchema.default({ reverb: "room", loudness: -14, fadeOut: 0.4, limiter: true }),
    cues: z
      .record(z.string().regex(CUE_NAME_PATTERN, { error: "Cue names start with a lowercase letter and use only letters, digits and _." }), CueSchema)
      .default({})
      .describe('Named moments, e.g. { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } }. Notes can be placed on them and the timing map reports them.'),
    tracks: z.array(TrackSchema).min(1),
  })
  .describe("A jingle: a short piece of music and sound effects, with named cues an animation can sync to.");

export type ScoreData = z.output<typeof ScoreBaseSchema>;
export type ScoreInput = z.input<typeof ScoreBaseSchema>;
export type Track = z.output<typeof TrackSchema>;
export type Note = z.output<typeof NoteSchema>;
