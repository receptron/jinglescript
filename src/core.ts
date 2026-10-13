// The part of the library that runs anywhere JavaScript does: no Node built-ins, no ffmpeg, no files.
// Both entries re-export it: index.ts adds the Node-only parts, browser.ts the browser's.
export { parseScore, checkScore, ScoreSchema, JingleScriptError, formatProblem } from "./score.ts";
export type { Score, ScoreProblem, CheckResult } from "./score.ts";
export { ScoreBaseSchema, NoteSchema, TrackSchema, CueSchema, AtSchema, FORMAT } from "./score-schema.ts";
export type { ScoreInput, Note, Track } from "./score-schema.ts";
export { render, samplesNeeded, DEFAULT_SAMPLE_RATE, SAMPLE_RATES } from "./render.ts";
export type { RenderOptions, RenderResult, SampleRate } from "./render.ts";
export { TimingSchema, TIMING_FORMAT } from "./timing.ts";
export type { TimingMap, TimingNote, TimingLyricLine } from "./timing.ts";
export type { MasterStats } from "./dsp/master.ts";
export { SamplesNotLoadedError } from "./samples/source.ts";
export type { SampleSource, SampleData } from "./samples/source.ts";
export { scoreToMidi, MIDI_MIME_TYPE } from "./midi.ts";
export { toWav } from "./wav.ts";
export type { WavBits } from "./wav.ts";
export { tagsOf } from "./tags.ts";
export type { AudioTags } from "./tags.ts";
export { integratedLoudness, truePeak } from "./dsp/loudness.ts";
export { getSchema, getAuthoringGuide, listInstruments, getInstrument, SCHEMA_PARTS } from "./llm.ts";
export type { SchemaPart, InstrumentInfo } from "./llm.ts";
export { INSTRUMENT_NAMES } from "./instruments/index.ts";
export type { InstrumentName, InstrumentDescriptor } from "./instruments/index.ts";
export { demoScore } from "./demo.ts";
