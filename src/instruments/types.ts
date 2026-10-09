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
  /**
   * Cents to move the default pitch by when `frequency` is undefined: set by a tweak whose base
   * (a stack of layers) has no single default pitch of its own, and applied by the layers' tweaks.
   */
  retune?: number;
  /** Index of this pitch within its chord (absent or 0 for a single note): a layered instrument plays its unpitched layers once per chord. */
  chordVoice?: number;
}

export interface InstrumentDescriptor {
  kind: "instrument" | "sfx";
  /** One line for people and LLMs: what it sounds like and what it is good for. */
  description: string;
  pitched: boolean;
  /** For unpitched sounds that may still take a `pitch` (a laser's starting pitch). */
  pitchOptional?: boolean;
  /** For sounds with an optional pitch: the frequency in Hz they play when a note gives none. */
  defaultFrequency?: number;
  /**
   * Sounds whose length is set by `len` (a whoosh, a riser, a laser sweep): their default length,
   * and they may be placed by `end` instead of `at`.
   */
  duration?: { defaultSeconds: number; maxSeconds?: number };
  /**
   * A very short impulse (a tick, a step, a knock). It is balanced by its peak — as loud at its
   * peak as a C5 marimba note — rather than by loudness, which for an impulse would push its peak
   * far above the music.
   */
  transient?: boolean;
  /** Sustained sounds hold for `len`; the others ring out on their own. */
  sustained: boolean;
  /** Lowest and highest pitch that renders cleanly; null for unpitched sounds. */
  range: { low: string; high: string } | null;
  /** The first is the default. */
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
