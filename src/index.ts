// JingleScript library for Node: a score → audio + timing map, and the API for LLMs. The browser
// entry (browser.ts) shares everything in core.ts; what is added here needs Node (files, ffmpeg).
export * from "./core.ts";
export { loadSamples, defaultCacheDir, SampleDownloadError } from "./samples/load.ts";
export type { LoadSamplesOptions } from "./samples/load.ts";
export { renderToFiles } from "./output.ts";
export { manage, ManageInputSchema, manageInputJsonSchema, MANAGE_TOOL, MANAGE_ACTIONS, MANAGE_DESCRIPTION } from "./manage.ts";
export type { ManageInput, ManageResult, ManageOptions, PlayerData, ManageAction } from "./manage.ts";
export { AUDIO_FORMATS, FfmpegMissingError } from "./encode.ts";
export type { AudioFormat } from "./encode.ts";
