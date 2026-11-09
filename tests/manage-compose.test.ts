// composeScore without YuE2: a stand-in "python" answers like compose()'s plan script does, so
// these run with no model, GPU or network.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { manage, ManageInputSchema } from "../src/manage.ts";

const ABC = String.raw`X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=120\nV: Vocal\nV: Ins\nK:C\n% intro\nV: Vocal\n\"C\"z32|\nV: Ins\nc8e8g16|\n% chorus\nV: Vocal\n\"F\"f8a8\"G7\"g16|\nV: Ins\nZ|\n`;

const dir = mkdtempSync(join(tmpdir(), "jinglescript-compose-"));

function fakePython(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

const ok = fakePython("ok", `cat >/dev/null; printf '%s' '{"abc": "${ABC}", "truncated": false, "tokens": 42, "seconds": 1.5}'`);

const Answer = z.object({
  ok: z.literal(true),
  path: z.string().optional(),
  score: z.unknown().optional(),
  sections: z.array(z.string()),
  lyrics: z.array(z.string()).optional(),
  notes: z.number(),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("composeScore", () => {
  it("saves the score where the carrier keeps files, and renderScore plays it from there", async () => {
    vi.stubEnv("YUE2_PYTHON", ok);
    const files = new Map<string, string>();
    const options = {
      // Like the real carriers: a name that is taken is not overwritten.
      saveFile: (name: string, content: string) => {
        if (files.has(`songs/${name}`)) return Promise.resolve(undefined);
        files.set(`songs/${name}`, content);
        return Promise.resolve(`songs/${name}`);
      },
      readScoreFile: (path: string) => Promise.resolve(files.get(path) ?? ""),
    };
    const result = await manage({ action: "composeScore", style: "bright jingle", lyrics: "[Chorus]\nはてな", section: "chorus", fileName: "hatena" }, options);
    expect(result.isError).toBe(false);
    const answer = Answer.parse(JSON.parse(result.text));
    expect(answer).toMatchObject({ path: "songs/hatena.json", sections: ["intro", "chorus"] });
    expect(answer.lyrics?.[0]).toBe("lyrics on 1 phrases: 1 exact");
    expect([...files.keys()]).toEqual(["songs/hatena.json", "songs/hatena.abc"]);
    expect(files.get("songs/hatena.json")).toContain('"lyric": "は"');
    const rendered = await manage({ action: "renderScore", path: "songs/hatena.json" }, options);
    expect(rendered.isError).toBe(false);
  });

  it("never replaces an earlier composition: the next one of the same name is numbered", async () => {
    vi.stubEnv("YUE2_PYTHON", ok);
    const files = new Map<string, string>([["songs/song.abc", "an ABC left on its own"]]);
    const saveFile = (name: string, content: string) => {
      if (files.has(`songs/${name}`)) return Promise.resolve(undefined);
      files.set(`songs/${name}`, content);
      return Promise.resolve(`songs/${name}`);
    };
    const paths: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await manage({ action: "composeScore", style: "s", lyrics: "la la" }, { saveFile });
      paths.push(Answer.parse(JSON.parse(result.text)).path);
    }
    expect(paths).toEqual(["songs/song.json", "songs/song-2.json", "songs/song-3.json"]);
    expect(files.get("songs/song.abc")).toBe("an ABC left on its own");
    expect(files.has("songs/song-2.abc")).toBe(true);
  });

  it("answers with the score itself when the carrier keeps no files", async () => {
    vi.stubEnv("YUE2_PYTHON", ok);
    const result = await manage({ action: "composeScore", style: "s", lyrics: "la la" });
    const answer = Answer.parse(JSON.parse(result.text));
    expect(answer.path).toBeUndefined();
    expect(answer.score).toMatchObject({ format: "jinglescript/1" });
  });

  it("tells the model how to set YuE2 up when it is missing, and what an unknown instrument is", async () => {
    vi.stubEnv("YUE2_PYTHON", join(dir, "nope"));
    const missing = await manage({ action: "composeScore", style: "s", lyrics: "l" });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toMatch(/YuE2 is not available[\s\S]*YUE2_PYTHON=/);
    const unknown = await manage({ action: "composeScore", style: "s", lyrics: "l", melody: "kazoo" });
    expect(unknown).toMatchObject({ isError: true, text: expect.stringContaining('Unknown instrument "kazoo"') });
  });

  it("needs a style and lyrics", () => {
    const issues = ManageInputSchema.safeParse({ action: "composeScore" }).error?.issues.map((issue) => issue.message);
    expect(issues).toEqual(["composeScore needs `style`.", "composeScore needs `lyrics`."]);
  });
});
