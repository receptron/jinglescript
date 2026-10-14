import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packageVersion } from "../src/version.ts";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
// Node runs .ts by default from 22.18; the oldest supported Node (22.12) needs the flag.
const stripTypes = process.features.typescript ? [] : ["--experimental-strip-types"];
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("version", () => {
  it("is package.json's (src/version.ts is stale: run `node scripts/write-version.ts`)", () => {
    expect(packageVersion()).toBe(version);
  });

  it("is what the CLI prints for --version and -v", () => {
    for (const flag of ["--version", "-v"]) {
      expect(execFileSync(process.execPath, [...stripTypes, cli, flag], { encoding: "utf8" }).trim()).toBe(version);
    }
  });
});
