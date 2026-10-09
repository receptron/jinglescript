// Music box, the improved version from the prototype (instruments2.py): an octave up, comb-tine
// modes 1×, 5.4×, 13.1×, and a pin-pluck tick. The prototype's 0.8 ms onset is raised to the 1 ms
// minimum every note gets.
import { modalNote } from "./modal.ts";
import type { Instrument } from "./types.ts";
import * as dmath from "../dsp/math.ts";

export const VOICE = {
  modes: [
    { ratio: 1, level: 1, decay: 1.1 },
    { ratio: 5.4, level: 0.3, decay: 0.15 },
    { ratio: 13.1, level: 0.08, decay: 0.04 },
  ],
  click: 0.5,
  clickSeconds: 0.0025,
  clickWindowed: false,
  // -2.2 dB: loudness of a C5 at full velocity matched to the marimba's.
  level: dmath.dbToGain(-2.2),
};

export const musicbox: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Tiny plucked steel comb: delicate, nostalgic, lullaby-like. Sounds an octave above the written pitch.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C7" },
    variants: [],
    transpose: 12,
    synthetic: false,
  },
  synthesize: (input) => modalNote(input, VOICE),
};
