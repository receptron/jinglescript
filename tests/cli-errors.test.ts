import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { fileProblem, userFacingMessage } from "../src/cli-errors.ts";
import { FfmpegMissingError } from "../src/encode.ts";
import { JingleScriptError } from "../src/score.ts";
import { SampleDownloadError } from "../src/samples/fetch-sample.ts";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
// Node runs .ts by default from 22.18; the oldest supported Node (22.12) needs the flag.
const stripTypes = process.features.typescript ? [] : ["--experimental-strip-types"];
const run = (...args: string[]) => spawnSync(process.execPath, [...stripTypes, cli, ...args], { encoding: "utf8" });
const example = new URL("../examples/hatena-marumo-a.json", import.meta.url).pathname;

/** The error a real call throws, so the tests see Node's own codes and paths. */
async function thrownBy(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("userFacingMessage", () => {
  it("passes on the library's own user errors", () => {
    expect(userFacingMessage(new JingleScriptError([{ path: "tempo", message: "bad" }]))).toMatch(/tempo: bad/);
    expect(userFacingMessage(new FfmpegMissingError("mp3"))).toMatch(/ffmpeg/);
    expect(userFacingMessage(new SampleDownloadError("offline"))).toBe("offline");
  });

  it("turns argument-parsing errors into the message plus where to find usage", async () => {
    const unknown = await thrownBy(() => parseArgs({ args: ["--foo"], options: {} }));
    expect(userFacingMessage(unknown)).toMatch(/^Unknown option '--foo'.*\nRun `jinglescript --help` for usage\.$/s);
    const missing = await thrownBy(() => parseArgs({ args: ["-o"], options: { out: { type: "string", short: "o" } } }));
    expect(userFacingMessage(missing)).toMatch(/argument missing/);
  });

  it("names the path and the problem for file errors", async () => {
    expect(userFacingMessage(await thrownBy(() => readFile("no-such-file.json")))).toBe("no-such-file.json: no such file or folder.");
    // A read of a folder fails without a path: the reason is known, the file name comes from the caller.
    const folderRead = await thrownBy(() => readFile(new URL("../examples", import.meta.url)));
    expect(fileProblem(folderRead)).toBe("is a folder, not a file");
    expect(userFacingMessage(folderRead)).toBeUndefined();
    expect(fileProblem(new Error("not a file error"))).toBeUndefined();
    const intoFile = await thrownBy(() => mkdir(new URL("../examples/hatena-marumo-a.json", import.meta.url), { recursive: true }));
    expect(userFacingMessage(intoFile)).toMatch(/hatena-marumo-a\.json: is a file, not a folder\.$/);
  });

  it("leaves everything else to be thrown with its stack", () => {
    for (const error of [
      new Error("bug"),
      new TypeError("x is undefined"),
      Object.assign(new Error("odd"), { code: "ENOENT" }),
      Object.assign(new Error("x"), { code: 42 }),
      "a string",
      undefined,
      null,
    ]) {
      expect(userFacingMessage(error)).toBeUndefined();
    }
  });
});

describe("the CLI on mistakes a user can fix", () => {
  const cases: [string[], RegExp][] = [
    [["render", "--foo"], /Unknown option '--foo'/],
    [["render", example, "-o"], /argument missing/],
    [["--seed"], /argument missing/],
    [["check", "no-such-file.json"], /no-such-file\.json: no such file or folder\./],
    [["check", new URL("../examples", import.meta.url).pathname], /is a folder, not a file/],
    // An output path through an existing file fails the same way on every machine and user.
    [["render", example, "-o", `${example}/x.wav`], /hatena-marumo-a\.json: is a file, not a folder\./],
    [["render", example, "-o", `${example}/sub/x.wav`], /hatena-marumo-a\.json\/sub: a part of the path is not a folder\./],
  ];
  it.each(cases)("%j prints a message, not a stack trace, and exits 1", (args, message) => {
    const { status, stderr } = run(...args);
    expect(status).toBe(1);
    expect(stderr).toMatch(message);
    expect(stderr.split("\n").filter((line) => line.trimStart().startsWith("at "))).toEqual([]);
  });
});
