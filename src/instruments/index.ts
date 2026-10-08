// The built-in instruments and sound effects. Adding a name to INSTRUMENT_NAMES without an entry
// in INSTRUMENTS is a type error.
import { marimba } from "./marimba.ts";
import type { Instrument, InstrumentDescriptor } from "./types.ts";

export const INSTRUMENT_NAMES = ["marimba"] as const;
export type InstrumentName = (typeof INSTRUMENT_NAMES)[number];

export const INSTRUMENTS: Record<InstrumentName, Instrument> = {
  marimba,
};

export function isInstrumentName(name: string): name is InstrumentName {
  return INSTRUMENT_NAMES.some((known) => known === name);
}

export function descriptorOf(name: InstrumentName): InstrumentDescriptor {
  return INSTRUMENTS[name].descriptor;
}

export type { Instrument, InstrumentDescriptor, SynthInput } from "./types.ts";
