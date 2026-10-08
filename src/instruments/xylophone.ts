// Xylophone, from the prototype (instruments.py): modes 1×, 3.0×, 6.1×, short decays, a hard click.
import { modalNote } from "./modal.ts";
import type { Instrument } from "./types.ts";

const VOICE = {
  modes: [
    { ratio: 1, level: 1, decay: 0.18 },
    { ratio: 3.0, level: 0.5, decay: 0.05 },
    { ratio: 6.1, level: 0.2, decay: 0.02 },
  ],
  click: 0.35,
  // +2.3 dB: loudness of a C5 at full velocity matched to the marimba's.
  level: 10 ** (2.3 / 20),
};

export const xylophone: Instrument = {
  descriptor: {
    kind: "instrument",
    description: "Hard wooden bars, bright and dry with a short ring: quick runs, playful and comedic hits, cartoon energy.",
    pitched: true,
    sustained: false,
    range: { low: "C3", high: "C7" },
    variants: [],
    transpose: 0,
    synthetic: false,
  },
  synthesize: (input) => modalNote(input, VOICE),
};
