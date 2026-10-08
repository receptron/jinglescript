// The API for LLMs: everything an LLM (or an agent) needs to learn the format, see what sounds
// exist and check its work, as plain JSON. The CLI and the MCP server wrap these functions.
import { z } from "zod";
import { AUTHORING_GUIDE } from "./guide.ts";
import { INSTRUMENT_NAMES, INSTRUMENTS, isInstrumentName, type InstrumentDescriptor, type InstrumentName } from "./instruments/index.ts";
import { CueSchema, NoteSchema, ScoreBaseSchema, TrackSchema } from "./score-schema.ts";
import { TimingSchema } from "./timing.ts";

const SCHEMA_PARTS_TABLE = {
  score: ScoreBaseSchema,
  track: TrackSchema,
  note: NoteSchema,
  cue: CueSchema,
  timing: TimingSchema,
} as const;

export type SchemaPart = keyof typeof SCHEMA_PARTS_TABLE;
export const SCHEMA_PARTS: readonly SchemaPart[] = ["score", "track", "note", "cue", "timing"];

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
}

export function listInstruments(): InstrumentInfo[] {
  return INSTRUMENT_NAMES.map((name) => ({ name, ...INSTRUMENTS[name].descriptor }));
}

export function getInstrument(name: string): InstrumentInfo | undefined {
  return isInstrumentName(name) ? { name, ...INSTRUMENTS[name].descriptor } : undefined;
}
