import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(new URL("../skills/jinglescript/SKILL.md", import.meta.url), "utf8");
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
// Node runs .ts by default from 22.18; the oldest supported Node (22.12) needs the flag.
const stripTypes = process.features.typescript ? [] : ["--experimental-strip-types"];
const usage = execFileSync(process.execPath, [...stripTypes, cli, "--help"], { encoding: "utf8" });

describe("skills/jinglescript/SKILL.md", () => {
  it("has the frontmatter Claude Code reads (name and description)", () => {
    expect(skill).toMatch(/^---\nname: jinglescript\ndescription: .+\n---\n/);
  });

  it("only uses commands the CLI has", () => {
    const commands = [...skill.matchAll(/npx -y jinglescript (\w+)/g)].map((match) => match[1] ?? "");
    expect(commands.length).toBeGreaterThan(4);
    expect(commands.filter((command) => !usage.includes(`jinglescript ${command}`))).toEqual([]);
  });
});
