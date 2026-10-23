import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skill = readFileSync(new URL("../skills/jinglescript/SKILL.md", import.meta.url), "utf8");
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
// Node runs .ts by default from 22.18; the oldest supported Node (22.12) needs the flag.
const stripTypes = process.features.typescript ? [] : ["--experimental-strip-types"];

// Every command the skill tells an agent to run, as written between backticks.
const commands = [...skill.matchAll(/`npx -y jinglescript ([^`]+)`/g)].map((match) => match[1] ?? "");

/** A command's words with the skill's placeholders filled in; MP3 becomes WAV (CI has no ffmpeg). */
const filledIn = (command: string): string[] =>
  command
    .replaceAll("<short-name>", "logo")
    .replaceAll("<instrument>", "marimba")
    .replaceAll("<name>", "marimba")
    .replace(/\.mp3$/, ".wav")
    .split(" ");

describe("skills/jinglescript/SKILL.md", () => {
  const project = mkdtempSync(join(tmpdir(), "jinglescript-skill-"));
  afterAll(() => rmSync(project, { recursive: true, force: true }));
  // The score step 3 would have written.
  mkdirSync(join(project, "jingles"));
  writeFileSync(join(project, "jingles", "logo.json"), readFileSync(new URL("../examples/hatena-marumo-a.json", import.meta.url)));

  it("has the frontmatter Claude Code reads (name and description)", () => {
    expect(skill).toMatch(/^---\nname: jinglescript\ndescription: .+\n---\n/);
  });

  it("names the commands it relies on", () => {
    const verbs = new Set(commands.map((command) => command.split(" ")[0]));
    expect([...verbs].sort()).toEqual(["check", "demo", "guide", "instruments", "notation", "render", "schema"]);
  });

  // Run as written: a renamed command, a wrong flag or a missing argument fails here.
  it.each(commands)("`npx -y jinglescript %s` runs as written", (command) => {
    const { status, stderr } = spawnSync(process.execPath, [...stripTypes, cli, ...filledIn(command)], { cwd: project, encoding: "utf8" });
    // stderr is in the comparison so a failure shows the CLI's message.
    expect({ status, stderr: status === 0 ? "" : stderr }).toEqual({ status: 0, stderr: "" });
  });
});
