// Built-ins written in the block vocabulary, where their model fits: the bars and tines (modes and
// a noise click), the ukulele (a string) and the organ (sine drawbars, a key click, an envelope and
// a tremolo). Each is derived from the constants the built-in itself plays, so the two cannot
// drift apart; tests/custom.test.ts checks they sound alike. They are what getInstrument shows an
// LLM to copy and change, and what a `decay` tweak above 1 renders.
//
// The rest stay code: the piano, trumpet and piccolo need models the vocabulary lacks (hammer
// spectra, lip and breath dynamics), the clap and the effects have variants, and effects such as
// the laser shape themselves relative to their length, which block envelopes do not.
import { RING_TIME_CONSTANTS } from "../instruments/common.ts";
import type { InstrumentName } from "../instruments/index.ts";
import { CLICK_LEVEL, CLICK_SECONDS as MARIMBA_CLICK_SECONDS, MODES as MARIMBA_MODES } from "../instruments/marimba.ts";
import { CLICK_SECONDS, type ModalVoice } from "../instruments/modal.ts";
import { VOICE as GLOCKENSPIEL } from "../instruments/glockenspiel.ts";
import { VOICE as MUSICBOX } from "../instruments/musicbox.ts";
import { DRAWBARS, ENVELOPE, KEY_CLICK, WOBBLE_DEPTH, WOBBLE_HZ } from "../instruments/organ.ts";
import { SOFT_TONE } from "../instruments/ukulele.ts";
import { TREMOLO_DEPTH, TREMOLO_HZ, VOICE as VIBRAPHONE } from "../instruments/vibraphone.ts";
import { VOICE as XYLOPHONE } from "../instruments/xylophone.ts";
import type { BlocksDefinitionInput } from "./schema.ts";

/** A time constant as the vocabulary's "seconds to −60 dB", rounded to the millisecond. */
const t60 = (tau: number): number => Math.round(tau * RING_TIME_CONSTANTS * 1000) / 1000;

/** The marimba smooths its click with a 12-tap moving average at 48 kHz: about a 1.6 kHz low-pass. */
const MARIMBA_CLICK_CUTOFF = 1600;

function modal(voice: ModalVoice, description: string): BlocksDefinitionInput {
  return {
    description,
    blocks: [
      { modes: voice.modes.map((m) => ({ ratio: m.ratio, level: m.level, decay: t60(m.decay) })) },
      { noise: "white", burst: voice.clickSeconds ?? CLICK_SECONDS, level: voice.click },
    ],
  };
}

export const BUILTIN_DEFINITIONS: Partial<Record<InstrumentName, BlocksDefinitionInput>> = {
  marimba: {
    description: "Marimba: three bar modes (the lower two ring longer on low notes) and a soft mallet click.",
    blocks: [
      { modes: MARIMBA_MODES.filter((m) => m.lowRingsLonger).map((m) => ({ ratio: m.ratio, level: m.level, decay: t60(m.decay) })), lowRingsLonger: 1 },
      { modes: MARIMBA_MODES.filter((m) => !m.lowRingsLonger).map((m) => ({ ratio: m.ratio, level: m.level, decay: t60(m.decay) })) },
      { noise: "white", burst: MARIMBA_CLICK_SECONDS, level: CLICK_LEVEL, filter: { type: "lowpass", cutoff: MARIMBA_CLICK_CUTOFF } },
    ],
  },
  xylophone: modal(XYLOPHONE, "Xylophone: three hard-bar modes with short rings and a hard click."),
  glockenspiel: modal(GLOCKENSPIEL, "Glockenspiel: four steel-bar modes with a long ring and a light click."),
  vibraphone: {
    ...modal(VIBRAPHONE, "Vibraphone: three metal-bar modes with a long ring and a 5.5 Hz tremolo."),
    blocks: [...modal(VIBRAPHONE, "").blocks, { lfo: "tremolo", rate: TREMOLO_HZ, depth: TREMOLO_DEPTH }],
  },
  musicbox: modal(MUSICBOX, "Music box: three comb-tine modes and a pin tick (the built-in sounds an octave above the written pitch)."),
  ukulele: {
    description: "Ukulele: a soft nylon string, finger-plucked.",
    blocks: [
      {
        string: {
          pluck: SOFT_TONE.pluckHz,
          position: SOFT_TONE.pluckPosition,
          damping: SOFT_TONE.damping,
          ring: SOFT_TONE.ringSeconds,
          body: SOFT_TONE.bodyHz,
        },
      },
    ],
  },
  organ: {
    description: "Organ: six sine drawbars, a key click, a held envelope and a rotary-like tremolo.",
    blocks: [
      ...DRAWBARS.map((bar) => ({ osc: "sine" as const, ratio: bar.ratio, level: bar.level })),
      { noise: "white", burst: KEY_CLICK.seconds, level: KEY_CLICK.level },
      { env: { attack: ENVELOPE.attack, decay: ENVELOPE.decay, sustain: ENVELOPE.sustain, release: t60(ENVELOPE.release) } },
      { lfo: "tremolo", rate: WOBBLE_HZ, depth: 2 * WOBBLE_DEPTH },
    ],
  },
};
