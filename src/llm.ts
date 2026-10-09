// The API for LLMs: everything an LLM (or an agent) needs to learn the format, see what sounds
// exist and check its work, as plain JSON. The CLI and the MCP server wrap these functions.
import { z } from "zod";
import { BUILTIN_DEFINITIONS } from "./custom/builtins.ts";
import { DefinitionSchema, type BlocksDefinitionInput } from "./custom/schema.ts";
import { AUTHORING_GUIDE } from "./guide.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS, isInstrumentName, type InstrumentDescriptor, type InstrumentName } from "./instruments/index.ts";
import { CueSchema, NoteSchema, ScoreBaseSchema, TrackSchema } from "./score-schema.ts";
import { TimingSchema } from "./timing.ts";

export const SCHEMA_PARTS = ["score", "track", "note", "cue", "instrument", "timing"] as const;
export type SchemaPart = (typeof SCHEMA_PARTS)[number];

const SCHEMA_PARTS_TABLE: Record<SchemaPart, z.ZodType> = {
  score: ScoreBaseSchema,
  track: TrackSchema,
  note: NoteSchema,
  cue: CueSchema,
  instrument: DefinitionSchema,
  timing: TimingSchema,
};

export function isSchemaPart(name: string): name is SchemaPart {
  return SCHEMA_PARTS.some((part) => part === name);
}

/** JSON Schema (draft 2020-12) of the score, or of one part of it, generated from the zod schemas. */
export function getSchema(part: SchemaPart = "score"): Record<string, unknown> {
  const schema = z.toJSONSchema(SCHEMA_PARTS_TABLE[part], { io: "input", target: "draft-2020-12" });
  return { ...schema, title: part === "timing" ? "jinglescript-timing/1" : `jinglescript/1 ${part}` };
}

/** How to write a good score, as Markdown. */
export function getAuthoringGuide(): string {
  return AUTHORING_GUIDE;
}

export interface InstrumentInfo extends InstrumentDescriptor {
  name: InstrumentName;
  /**
   * The built-in written as a custom instrument's `blocks`, when its model fits the vocabulary:
   * copy it under "instruments" and change it. Built-ins with one also take `decay` above 1.
   */
  definition?: BlocksDefinitionInput;
}

function info(name: InstrumentName): InstrumentInfo {
  const definition = BUILTIN_DEFINITIONS[name];
  return { name, ...INSTRUMENTS[name].descriptor, ...(definition === undefined ? {} : { definition }) };
}

export function listInstruments(): InstrumentInfo[] {
  // The list stays short; getInstrument gives a built-in's definition.
  return INSTRUMENT_NAMES.map((name) => ({ name, ...INSTRUMENTS[name].descriptor }));
}

export function getInstrument(name: string): InstrumentInfo | undefined {
  return isInstrumentName(name) ? info(name) : undefined;
}
