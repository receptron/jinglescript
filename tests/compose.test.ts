// compose() without YuE2: a stand-in "python" answers like the plan script does, so these run
// with no model, GPU or network.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compose, planWithYuE2, yue2Python, Yue2Error, Yue2MissingError } from "../src/compose.ts";

const ABC = String.raw`X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=120\nV: Vocal\nV: Ins\nK:C\n% intro\nV: Vocal\n\"C\"z32|\nV: Ins\nc8e8g16|\n% chorus\nV: Vocal\n\"F\"f8a8\"G7\"g16|\nV: Ins\nZ|\n`;

const dir = mkdtempSync(join(tmpdir(), "jinglescript-yue2-"));

function fakePython(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

// Echoes the request it was sent to stderr (as YuE2's progress would go), then answers.
const ok = fakePython(
  "ok",
  `cat >&2; echo >&2; echo '[YuE2] Completed Planning score: 42 tokens' >&2; printf '%s' '{"abc": "${ABC}", "truncated": false, "tokens": 42, "seconds": 1.5}'`,
);

describe("planWithYuE2", () => {
  it("sends the request and returns YuE2's ABC, passing its progress on", async () => {
    const lines: string[] = [];
    const plan = await planWithYuE2(
      { style: "bright jingle", lyrics: "[Chorus]\nla la", seed: 3 },
      { python: ok, device: "cpu", onProgress: (line) => lines.push(line) },
    );
    expect(plan).toMatchObject({ truncated: false, tokens: 42, seconds: 1.5 });
    expect(plan.abc).toContain("% chorus");
    const sent: unknown = JSON.parse(lines[0] ?? "");
    expect(sent).toEqual({
      model: "m-a-p/YuE2-3B",
      device: "cpu",
      request: { id: "jinglescript", style: "bright jingle", lyrics: "[Chorus]\nla la", seed: 3, cot: "full" },
    });
    expect(lines).toContain("[YuE2] Completed Planning score: 42 tokens");
  });

  it("says how to set YuE2 up when it is missing", async () => {
    await expect(planWithYuE2({ style: "s", lyrics: "l" }, { python: join(dir, "nope") })).rejects.toThrow(Yue2MissingError);
    const noModule = fakePython("no-module", "echo 'cannot import yue2: No module named yue2' >&2; exit 3");
    await expect(planWithYuE2({ style: "s", lyrics: "l" }, { python: noModule })).rejects.toThrow(/cannot import yue2[\s\S]*YUE2_PYTHON=/);
    const noWeights = fakePython("no-weights", "echo 'the m-a-p/YuE2-3B weights are not downloaded' >&2; exit 4");
    await expect(planWithYuE2({ style: "s", lyrics: "l" }, { python: noWeights })).rejects.toThrow(/weights are not downloaded/);
  });

  it("reports a crash with the end of YuE2's output", async () => {
    const crash = fakePython("crash", "echo 'RuntimeError: MPS backend out of memory' >&2; exit 1");
    await expect(planWithYuE2({ style: "s", lyrics: "l" }, { python: crash })).rejects.toThrow(Yue2Error);
    await expect(planWithYuE2({ style: "s", lyrics: "l" }, { python: crash })).rejects.toThrow(/exit 1[\s\S]*out of memory/);
  });
});

describe("yue2Python", () => {
  it("reads YUE2_PYTHON from the environment, else from .env", () => {
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "YUE2_PYTHON=/opt/yue2/bin/python\n");
    expect(yue2Python({ YUE2_PYTHON: "/usr/bin/python3" }, envFile)).toBe("/usr/bin/python3");
    expect(yue2Python({}, envFile)).toBe("/opt/yue2/bin/python");
    expect(yue2Python({}, join(dir, "missing.env"))).toBeUndefined();
  });
});

describe("compose", () => {
  it("turns YuE2's plan into a score and lists its sections", async () => {
    const composition = await compose({ style: "s", lyrics: "l", python: ok, section: "chorus", melody: "vibraphone" });
    expect(composition.sections).toEqual(["intro", "chorus"]);
    expect(composition.score.tracks.map((t) => t.name)).toEqual(["vocal", "chords", "bass"]);
    expect(composition.score.tracks[0]?.notes.map((n) => [n.at, n.pitch])).toEqual([
      [0, "F5"],
      [1, "A5"],
      [2, "G5"],
    ]);
  });
});
