// JingleScript library: a score → audio + timing map, and the API for LLMs.
export { parseScore, checkScore, ScoreSchema, JingleScriptError, formatProblem } from "./score.ts";
export type { Score, ScoreProblem, CheckResult } from "./score.ts";
export { ScoreBaseSchema, NoteSchema, TrackSchema, CueSchema, AtSchema, FORMAT } from "./score-schema.ts";
export type { ScoreInput, Note, Track } from "./score-schema.ts";
export { render, DEFAULT_SAMPLE_RATE, SAMPLE_RATES } from "./render.ts";
export type { RenderOptions, RenderResult, SampleRate } from "./render.ts";
export { TimingSchema, TIMING_FORMAT } from "./timing.ts";
export type { TimingMap, TimingNote } from "./timing.ts";
export type { MasterStats } from "./dsp/master.ts";
export { toWav } from "./wav.ts";
export type { WavBits } from "./wav.ts";
export { integratedLoudness, truePeak } from "./dsp/loudness.ts";
export { getSchema, getAuthoringGuide, listInstruments, getInstrument, SCHEMA_PARTS } from "./llm.ts";
export type { SchemaPart, InstrumentInfo } from "./llm.ts";
export { INSTRUMENT_NAMES } from "./instruments/index.ts";
export type { InstrumentName, InstrumentDescriptor } from "./instruments/index.ts";
