// The jinglescript/1 score format, structurally. These zod schemas are the single source of truth:
// the TypeScript types are inferred from them and the published JSON Schema is generated from them.
// Descriptions are written for an LLM reader — they are part of the prompt.
// Checks that need the whole score (cues exist, pitches in range, notes before the end) are added
// in score.ts.
import { z } from "zod";
import { REVERBS } from "./dsp/reverb.ts";
import { CUSTOM_NAME_PATTERN, InstrumentsSchema } from "./custom/schema.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS } from "./instruments/index.ts";
import { CHORD_PATTERN, CHORD_QUALITIES } from "./chords.ts";
import { KEY_PATTERN, KEYS, METER_PATTERN, parseKey } from "./meter.ts";
import { PITCH_PATTERN } from "./pitch.ts";
import { STRUM_PATTERN } from "./strum.ts";
import { CUE_NAME_PATTERN, CUE_REF_PATTERN } from "./time.ts";

export const FORMAT = "jinglescript/1";
export const CLEFS = ["treble", "bass"] as const;

const instrumentList = INSTRUMENT_NAMES.map((name) => `"${name}"`).join(", ");
/** One line per sound for the schema: what it is, and the facts needed to write for it. */
function instrumentLine(name: (typeof INSTRUMENT_NAMES)[number]): string {
  const d = INSTRUMENTS[name].descriptor;
  const optional = d.pitched ? "" : " (optional pitch)";
  const facts = [
    d.range ? `range ${d.range.low}–${d.range.high}${optional}` : "no pitch",
    d.transpose === 12 ? "sounds an octave above the written pitch" : "",
    d.sustained ? "sustained (holds for len)" : "",
    d.damper ? "dampers: len releases the key, pedal holds it" : "",
    d.duration ? `len default ${d.duration.defaultSeconds} s` : "",
    d.variants.length > 0 ? `variants ${d.variants.join("/")}` : "",
    d.synthetic ? "sounds synthetic" : "",
  ].filter(Boolean);
  return `${name}: ${d.description} [${facts.join("; ")}]`;
}
const instrumentHelp = INSTRUMENT_NAMES.map(instrumentLine).join(" | ");

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
    at: AtSchema.optional(),
    end: AtSchema.optional().describe(
      'For effects with a length (whoosh, riser, laser): when it ends, instead of `at`. A riser into the hit is { "end": "hit", "len": 4 }.',
    ),
    pitch: z
      .union([PitchSchema, z.array(PitchSchema).min(1)], { error: 'A pitch is "C4", or a list of pitches for a chord: ["C4", "E4", "G4"].' })
      .optional()
      .describe("A pitch, or a list of pitches for a chord. Required for pitched instruments; leave it out for unpitched ones."),
    chord: z
      .string()
      .regex(CHORD_PATTERN, {
        error: `A chord is a root and a quality: "C", "Am", "G7", "Fmaj7", "Bb", "F#m7". Qualities: ${CHORD_QUALITIES.map((q) => (q === "" ? "(major)" : q)).join(", ")}.`,
      })
      .optional()
      .describe(
        'A chord by name instead of `pitch`: "C", "Am", "G7", "Fmaj7", "Bb", "F#m7", "Dsus4". The instrument voices it: a ukulele plays a real chord shape, other instruments stack it from octave 4. Use `pitch` instead for exact notes.',
      ),
    strum: z
      .union(
        [
          z.string().regex(STRUM_PATTERN),
          z.strictObject({
            pattern: z.string().regex(STRUM_PATTERN).describe('"down", "up", or a pattern such as "D-DU-UDU".'),
            grid: z.number().positive().optional().describe("Beats per pattern character (default 0.5: eighth notes; 0.25 for sixteenths)."),
            spread: z.number().min(1).max(80).optional().describe("Milliseconds between strings (default 15)."),
          }),
        ],
        {
          error:
            'strum is "down", "up", a pattern like "D-DU-UDU" (D down, U up, d/u soft, - rest; one character per eighth note), or { "pattern": …, "grid": …, "spread": … }.',
        },
      )
      .optional()
      .describe(
        'Strum the chord string by string, slightly loose like a real hand. "down" or "up" for one stroke, or a pattern: one character per eighth note, D = down, U = up, d/u = soft, - = rest. "D-DU-UDU" is one 4-beat bar of the classic island strum; combine with `repeat` ({ "every": 4, "count": 2 }) for more bars. A pitch list is strummed in the order written (string order).',
      ),
    vel: z.number().min(0).max(1).default(0.8).describe("Velocity 0–1: how hard the note is played (0.8 normal, 1 the big hit, 0.35 a soft echo)."),
    len: z
      .union([z.number().positive(), z.strictObject({ seconds: z.number().positive() })], {
        error: 'len is a number of beats (2) or { "seconds": 1.5 }.',
      })
      .optional()
      .describe(
        'How long sustained instruments hold, and how long effects with a length (whoosh, riser, laser) last: a number of beats, or { "seconds": n } when the request gives seconds ("builds for 2 seconds" is { "seconds": 2 }). On instruments with dampers (grandpiano) it is how long the key is held: the note stops when it ends, unless the track\'s `pedal` is down then; leave it out to let the note ring. Other struck and plucked instruments ring out and ignore it.',
      ),
    pan: z.number().min(0).max(1).optional().describe("Overrides the track's pan for this note: 0 left, 0.5 centre, 1 right."),
    variant: z
      .union([z.string(), z.array(z.string()).min(1)])
      .optional()
      .describe('For sounds with variants (listed per instrument). A list cycles over `repeat`s, e.g. ["left", "right"].'),
    repeat: RepeatSchema.optional(),
    detune: z.number().min(-100).max(100).optional().describe("Cents (1/100 semitone) to detune this note by."),
    humanize: z.number().min(0).max(50).optional().describe("Up to this many ms of seeded random timing offset. Never moves a note placed exactly on a cue."),
    lyric: z
      .string()
      .min(1)
      .optional()
      .describe(
        'One syllable of the words sung on this note, shown karaoke-style; the instrument plays the melody (a track with `sing` sings it). Write the melody first and give its notes the syllables. One kana or mora per note in Japanese ("ハ", "テ", "ナ"); one syllable in English, ending in "-" when the word continues on the next note ("hap-", "py"). "_" holds the previous syllable over this note. On a track with `sing`, the notes are sung: one kana mora per note (no romaji/English), and a note without a lyric right after a sung note holds its vowel (a rest only when nothing is sounding).',
      ),
    lineEnd: z.boolean().optional().describe("true ends a line of lyrics after this note's syllable. The last syllable of a track ends its line anyway."),
  })
  .refine((note) => (note.at === undefined) !== (note.end === undefined), {
    error: "Give `at` (when it starts) — or, for effects with a length, `end` (when it finishes) — but not both.",
  })
  .describe("One note or chord (or one sound effect hit).");

export const PedalSchema = z
  .strictObject({
    at: AtSchema.describe('When the pedal goes down: beats, { "seconds": n }, or a cue (as a note\'s `at`).'),
    until: AtSchema.describe("When it lifts, after `at`. To change pedal, start the next span where this one ends."),
  })
  .describe("One stretch of sustain pedal.");

export const SingSchema = z
  .strictObject({
    engine: z
      .literal("neutrino")
      .describe(
        'The singing synthesizer: "neutrino". It is set up where the score is rendered (for people: NEUTRINO_DIR in .env, default /Applications/NEUTRINO); renderScore says so if it is missing.',
      ),
    voice: z.string().optional().describe('A NEUTRINO voice, e.g. "reina" or "merrow" (default REINA).'),
    level: z
      .number()
      .min(-24)
      .max(24)
      .optional()
      .describe("Vocal loudness over the other tracks, in LU (≈ dB). Default 4: the voice a little in front. The track's `gain` adds to it."),
  })
  .describe("Sing the track with NEUTRINO.");

export const TrackSchema = z
  .strictObject({
    instrument: z
      .union([z.enum(INSTRUMENT_NAMES), z.string().regex(CUSTOM_NAME_PATTERN)], {
        error: `Unknown instrument. Built-in: ${instrumentList}; or the name of one defined under "instruments".`,
      })
      .describe(`Which instrument or sound effect plays this track: a built-in, or one defined under "instruments". Built-in: ${instrumentHelp}`),
    name: z.string().optional().describe('Optional label for people, e.g. "melody" or "bass".'),
    gain: z.number().min(-60).max(12).default(0).describe("Track level in dB (0 = as is, -6 = about half as loud)."),
    pan: z.number().min(0).max(1).default(0.5).describe("0 left, 0.5 centre, 1 right."),
    reverb: z.boolean().default(true).describe("false keeps this track out of the reverb (dry, close effects such as clicks and ticks)."),
    sing: SingSchema.optional().describe(
      "Sing this track (its notes' kana `lyric`s) with NEUTRINO instead of playing its instrument; one track per score. Whether NEUTRINO and the voice are installed is known only by rendering: write the score and call renderScore, which answers with what is missing if anything is (it does not fall back to the instrument). Only the browser build cannot sing. The first render of a sung track takes tens of seconds; the same one again is instant.",
    ),
    notes: z.array(NoteSchema).min(1).describe("The notes, in any order."),
    clef: z
      .enum(CLEFS)
      .optional()
      .describe('Sheet music only: the staff\'s clef. Leave it out to choose from the pitches ("bass" when they are mostly below A3).'),
    notation: z
      .boolean()
      .optional()
      .describe("Sheet music only: false leaves this track off the sheet music (an accompaniment you do not want shown). Sound effects are never shown."),
    pedal: z
      .array(PedalSchema)
      .optional()
      .describe(
        "Sustain pedal, for instruments with dampers (grandpiano): stretches in time order that do not overlap. While it is down, notes whose `len` has ended ring on; when it lifts, they stop. Change pedal where the harmony changes, as the printed Ped. marks show. Notes without `len` ring out regardless. Two tracks of one piano (right and left hand) each need it.",
      ),
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
    title: z.string().optional().describe("Name of the jingle. Written to the audio file's tags and the MIDI file."),
    author: z
      .string()
      .optional()
      .describe("Who made the jingle (a person or company), written to the audio file's artist tag. Only fill it in when the user gives it; never guess."),
    copyright: z
      .string()
      .optional()
      .describe(
        'Copyright notice, e.g. "© 2026 Example Inc.", written to the audio file\'s copyright tag and the MIDI copyright event. Only fill it in when the user gives it; never guess.',
      ),
    tempo: z.number().min(20).max(400).describe("Beats per minute; one beat is a quarter note. 100–140 suits most jingles."),
    meter: z
      .string()
      .regex(METER_PATTERN, { error: 'meter is a time signature such as "4/4", "3/4", "2/4" or "6/8".' })
      .optional()
      .describe(
        'Time signature for sheet music, e.g. "4/4", "3/4", "6/8" (default "4/4"). It does not change the sound: `at`, `len` and `tempo` still count quarter notes, so a 3/4 bar is 3 beats and a 6/8 bar is 3 beats too.',
      ),
    key: z
      .string()
      .regex(KEY_PATTERN, { error: `key is a key such as "C", "G", "F", "Bb", "Am" or "F#m": ${KEYS.join(", ")}.` })
      .refine((key) => parseKey(key) !== undefined, { error: `That key needs more than seven sharps or flats. Keys: ${KEYS.join(", ")}.` })
      .optional()
      .describe(
        'Key signature for sheet music: a major key ("C", "G", "F", "Bb", "D") or a minor one with "m" ("Am", "Em", "Dm", "F#m"); default "C". It does not change the sound or the pitches: still write each note\'s real pitch ("F#4" in G major).',
      ),
    pickup: z
      .number()
      .positive()
      .optional()
      .describe(
        'Sheet music only: beats before the first full bar (an upbeat, as in Happy Birthday\'s "Hap-py" = 1 beat in 3/4). Bar lines then fall at pickup, pickup + one bar, and so on. Less than one bar.',
      ),
    length: LengthSchema,
    seed: z.int().min(0).default(1).describe("Seed for every random detail (mallet noise, reverb, humanize). Same score + seed = identical audio."),
    master: MasterSchema.default({ reverb: "room", loudness: -14, fadeOut: 0.4, limiter: true }),
    cues: z
      .record(z.string().regex(CUE_NAME_PATTERN, { error: "Cue names start with a lowercase letter and use only letters, digits and _." }), CueSchema)
      .default({})
      .describe('Named moments, e.g. { "hit": { "seconds": 1.5 }, "voice": { "seconds": 1.8 } }. Notes can be placed on them and the timing map reports them.'),
    instruments: InstrumentsSchema.optional(),
    tracks: z.array(TrackSchema).min(1),
  })
  .describe("A jingle: a short piece of music and sound effects, with named cues an animation can sync to.");

export type ScoreData = z.output<typeof ScoreBaseSchema>;
export type ScoreInput = z.input<typeof ScoreBaseSchema>;
export type Track = z.output<typeof TrackSchema>;
export type Note = z.output<typeof NoteSchema>;
