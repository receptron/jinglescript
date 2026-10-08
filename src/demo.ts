// Demo scores: an instrument across its range (and a chord), or an effect's variants three times
// each — what `jinglescript demo <name>` renders, so a person can hear a sound before using it.
import { INSTRUMENTS, type InstrumentName } from "./instruments/index.ts";
import { midiToPitch } from "./chords.ts";
import { pitchToMidi } from "./pitch.ts";
import { FORMAT, type ScoreInput } from "./score-schema.ts";

const STEP_SECONDS = 0.45;

/** Pitches across a range: every major third from the bottom, and the top. */
function rangePitches(low: string, high: string): string[] {
  const from = pitchToMidi(low) ?? 60;
  const to = pitchToMidi(high) ?? 72;
  const pitches: string[] = [];
  for (let m = from; m < to; m += 4) pitches.push(midiToPitch(m, false));
  return [...pitches, midiToPitch(to, false)];
}

export function demoScore(name: InstrumentName): ScoreInput {
  const { descriptor } = INSTRUMENTS[name];
  const at = (k: number): { seconds: number } => ({ seconds: Math.round(k * STEP_SECONDS * 1000) / 1000 });
  if (descriptor.pitched && descriptor.range !== null) {
    const pitches = rangePitches(descriptor.range.low, descriptor.range.high);
    const notes = [
      ...pitches.map((pitch, k) => ({ at: at(k), pitch, ...(descriptor.sustained ? { len: 0.8 } : {}) })),
      { at: at(pitches.length + 1), chord: "C", vel: 0.9, ...(descriptor.sustained ? { len: 3 } : {}) },
    ];
    return {
      format: FORMAT,
      title: `${name} demo`,
      tempo: 120,
      length: { seconds: (pitches.length + 5) * STEP_SECONDS + 2 },
      tracks: [{ instrument: name, notes }],
    };
  }
  const variants = descriptor.variants.length > 0 ? [...descriptor.variants] : [undefined];
  const gap = descriptor.duration ? descriptor.duration.defaultSeconds + 0.6 : 0.9;
  const notes = variants.flatMap((variant, v) =>
    [0, 1, 2].map((r) => ({ at: { seconds: Math.round((v * 3.5 + r) * gap * 1000) / 1000 }, ...(variant === undefined ? {} : { variant }) })),
  );
  return {
    format: FORMAT,
    title: `${name} demo`,
    tempo: 120,
    length: { seconds: (variants.length * 3.5 + 1) * gap + 1 },
    tracks: [{ instrument: name, notes }],
  };
}
