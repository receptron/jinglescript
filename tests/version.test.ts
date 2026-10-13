import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packageVersion } from "../src/version.ts";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("version", () => {
  it("is package.json's", () => {
    expect(packageVersion()).toBe(version);
  });

  it("is what the CLI prints for --version and -v", () => {
    for (const flag of ["--version", "-v"]) {
      expect(execFileSync(process.execPath, [cli, flag], { encoding: "utf8" }).trim()).toBe(version);
    }
  });
});
