// The timing map: the public contract with the animation. Computed from the score, never measured
// — except `audibleUntil`, which is measured on the final audio. Changing its shape is a breaking
// change (bump the format).
import { z } from "zod";
import type { Expanded } from "./events.ts";
import { roundMs, secondsPerBeat } from "./time.ts";

export const TIMING_FORMAT = "jinglescript-timing/1";

export const TimingNoteSchema = z.strictObject({
  t: z.number().describe("Onset in seconds."),
  track: z.int().min(0).describe("Index of the track in the score."),
  instrument: z.string(),
  pitch: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Pitch, or the chord's pitches; absent for unpitched sounds."),
  vel: z.number(),
  chord: z.string().optional().describe("The chord symbol, when written as one."),
  strum: z.enum(["down", "up"]).optional().describe("A strummed stroke: `t` is its first string."),
  variant: z.string().optional(),
  cue: z.string().optional().describe("Set when the note is placed exactly on this cue."),
});

export const TimingSchema = z
  .strictObject({
    format: z.literal(TIMING_FORMAT),
    tempo: z.number(),
    duration: z.number().describe("Length of the audio in seconds."),
    cues: z.record(z.string(), z.number()).describe("Every cue in the score, in seconds — including cues with no note on them."),
    beats: z.array(z.number()).describe("Every beat (quarter note) from 0 up to the end, in seconds."),
    notes: z.array(TimingNoteSchema).describe("Every note and sound, repetitions expanded, sorted by time."),
    audibleUntil: z.number().describe("When the audio falls below -40 dBFS for good (measured on the output)."),
  })
  .describe("When everything in a rendered jingle happens, in seconds rounded to 1 ms. Animation syncs to this.");

export type TimingMap = z.infer<typeof TimingSchema>;
export type TimingNote = z.infer<typeof TimingNoteSchema>;

export function buildTiming(expanded: Expanded, audibleUntil: number): TimingMap {
  const beat = secondsPerBeat(expanded.tempo);
  const beats: number[] = [];
  for (let k = 0; k * beat < expanded.duration - 1e-9; k++) beats.push(roundMs(k * beat));
  const notes = expanded.events.map((event): TimingNote => {
    const note: TimingNote = { t: roundMs(event.seconds), track: event.track, instrument: event.instrument, vel: Math.round(event.vel * 1000) / 1000 };
    if (event.pitches.length === 1) note.pitch = event.pitches[0];
    else if (event.pitches.length > 1) note.pitch = event.pitches;
    if (event.chord !== undefined) note.chord = event.chord;
    if (event.strum !== undefined) note.strum = event.strum.direction;
    if (event.variant !== undefined) note.variant = event.variant;
    if (event.cue !== undefined) note.cue = event.cue;
    return note;
  });
  const cues = Object.fromEntries(Object.entries(expanded.cues).map(([name, seconds]) => [name, roundMs(seconds)]));
  return { format: TIMING_FORMAT, tempo: expanded.tempo, duration: roundMs(expanded.duration), cues, beats, notes, audibleUntil: roundMs(audibleUntil) };
}
