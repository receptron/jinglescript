// Vibraphone, from the prototype (instruments.py): modes 1×, 4×, 10×, long decay, 5.5 Hz tremolo.
import { modalNote } from "./modal.ts";
import type { Instrument } from "./types.ts";

const TREMOLO_HZ = 5.5;
const TREMOLO_DEPTH = 0.25;

const VOICE = {
  modes: [
    { ratio: 1, level: 1, decay: 1.4 },
    { ratio: 4.0, level: 0.25, decay: 0.25 },
    { ratio: 10.0, level: 0.06, decay: 0.05 },
  ],
  click: 0.05,
  // -0.7 dB: loudness of a C5 at full velocity matched to the marimba's.
  level: 10 ** (-0.7 / 20),
  shape: (t: number) => 1 - (TREMOLO_DEPTH * (1 - Math.cos(2 * Math.PI * TREMOLO_HZ * t))) / 2,
};

export const vibraphone: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Metal bars with a shimmering tremolo: smooth, jazzy, calm. Lounge, tech and corporate stings, soft chords.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C7" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => modalNote(input, VOICE),
};
