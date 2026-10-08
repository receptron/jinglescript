import type { Rng } from "../rng.ts";

export interface SynthInput {
  /** Nominal MIDI note (before detune); undefined for unpitched sounds. */
  midi: number | undefined;
  /** Sounding frequency in Hz, detune applied; undefined for unpitched sounds. */
  frequency: number | undefined;
  /** 0–1. */
  velocity: number;
  /** Seconds a sustained sound is held before its release; struck and plucked sounds ignore it. */
  hold: number;
  variant: string | undefined;
  sampleRate: number;
  rng: Rng;
}

export interface InstrumentDescriptor {
  kind: "instrument" | "sfx";
  /** One line for people and LLMs: what it sounds like and what it is good for. */
  description: string;
  pitched: boolean;
  /** Sustained sounds hold for `len`; the others ring out on their own. */
  sustained: boolean;
  /** Lowest and highest pitch that renders cleanly; null for unpitched sounds. */
  range: { low: string; high: string } | null;
  variants: readonly string[];
  /** Open strings from the first string strummed to the last, for fretted instruments: chord names get real shapes. */
  tuning?: readonly string[];
  /** Semitones between the written pitch and the sounding one (12 = sounds an octave higher). */
  transpose: number;
  /** True when the model is known to sound synthetic rather than like the real thing. */
  synthetic: boolean;
}

export interface Instrument {
  descriptor: InstrumentDescriptor;
  /** Mono samples starting at the onset (no silent pre-roll), ending in silence. */
  synthesize(input: SynthInput): Float32Array;
}
