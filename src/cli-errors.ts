// Which errors the CLI reports as a one-line message instead of a stack trace: the ones a user (or
// an LLM driving `npx jinglescript`) can fix. Anything else is a bug and keeps its stack.
import { FfmpegMissingError, FfmpegWriteError } from "./encode.ts";
import { NeutrinoMissingError, NeutrinoVoiceMissingError } from "./singer/neutrino.ts";
import { SampleDownloadError } from "./samples/fetch-sample.ts";
import { JingleScriptError } from "./score.ts";

const USAGE_HINT = "Run `jinglescript --help` for usage.";

/** Node's argument-parsing and file-system errors carry these. */
const codeOf = (error: Error): string => {
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : "";
};
const pathOf = (error: Error): string | undefined => {
  const path: unknown = Reflect.get(error, "path");
  return typeof path === "string" ? path : undefined;
};

const FILE_PROBLEMS: Readonly<Record<string, string>> = {
  ENOENT: "no such file or folder",
  EISDIR: "is a folder, not a file",
  ENOTDIR: "a part of the path is not a folder",
  // mkdir of an output folder that is already a file
  EEXIST: "is a file, not a folder",
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  EROFS: "read-only file system",
};

/** What went wrong with a file, for a file-system error; undefined for anything else. */
export function fileProblem(error: unknown): string | undefined {
  return error instanceof Error ? FILE_PROBLEMS[codeOf(error)] : undefined;
}

/** The message to print for `error`, or undefined when it should be thrown with its stack. */
export function userFacingMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (
    error instanceof JingleScriptError ||
    error instanceof FfmpegMissingError ||
    error instanceof FfmpegWriteError ||
    error instanceof SampleDownloadError ||
    error instanceof NeutrinoMissingError ||
    error instanceof NeutrinoVoiceMissingError
  ) {
    return error.message;
  }
  const code = codeOf(error);
  if (code.startsWith("ERR_PARSE_ARGS_")) return `${error.message}\n${USAGE_HINT}`;
  const problem = fileProblem(error);
  // Some file errors (EISDIR from a read) carry no path; the caller that knows the file reports those.
  const path = pathOf(error);
  if (problem !== undefined && path !== undefined) return `${path}: ${problem}.`;
  return undefined;
}
