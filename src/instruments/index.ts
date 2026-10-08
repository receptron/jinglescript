// The built-in instruments and sound effects. Adding a name to INSTRUMENT_NAMES without an entry
// in INSTRUMENTS is a type error.
import { clap } from "./clap.ts";
import { glockenspiel } from "./glockenspiel.ts";
import { marimba } from "./marimba.ts";
import { musicbox } from "./musicbox.ts";
import { organ } from "./organ.ts";
import { piano } from "./piano.ts";
import { piccolo } from "./piccolo.ts";
import { trumpet } from "./trumpet.ts";
import { ukulele } from "./ukulele.ts";
import { vibraphone } from "./vibraphone.ts";
import { xylophone } from "./xylophone.ts";
import type { Instrument, InstrumentDescriptor } from "./types.ts";

export const INSTRUMENT_NAMES = [
  "marimba",
  "xylophone",
  "glockenspiel",
  "vibraphone",
  "musicbox",
  "piano",
  "organ",
  "ukulele",
  "piccolo",
  "trumpet",
  "clap",
] as const;
export type InstrumentName = (typeof INSTRUMENT_NAMES)[number];

export const INSTRUMENTS: Record<InstrumentName, Instrument> = {
  marimba,
  xylophone,
  glockenspiel,
  vibraphone,
  musicbox,
  piano,
  organ,
  ukulele,
  piccolo,
  trumpet,
  clap,
};

export function isInstrumentName(name: string): name is InstrumentName {
  return INSTRUMENT_NAMES.some((known) => known === name);
}

export function descriptorOf(name: InstrumentName): InstrumentDescriptor {
  return INSTRUMENTS[name].descriptor;
}

export type { Instrument, InstrumentDescriptor, SynthInput } from "./types.ts";
