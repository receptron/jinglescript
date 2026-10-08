// Glockenspiel, from the prototype (instruments.py): free-bar modes 1×, 2.76×, 5.40×, 8.93×, long decay.
import { modalNote } from "./modal.ts";
import type { Instrument } from "./types.ts";
import * as dmath from "../dsp/math.ts";

const VOICE = {
  modes: [
    { ratio: 1, level: 1, decay: 1.6 },
    { ratio: 2.76, level: 0.35, decay: 0.4 },
    { ratio: 5.4, level: 0.15, decay: 0.15 },
    { ratio: 8.93, level: 0.06, decay: 0.06 },
  ],
  click: 0.08,
  // -2.2 dB: loudness of a C5 at full velocity matched to the marimba's.
  level: dmath.dbToGain(-2.2),
};

export const glockenspiel: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Small steel bars: bell-like, sparkling, long ring. Magic, twinkles, a logo shine; doubles a melody an octave up at low gain for sparkle.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C8" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => modalNote(input, VOICE),
};
