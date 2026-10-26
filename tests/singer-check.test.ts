import { mkdtempSync, utimesSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkScore, JingleScriptError, parseScore, type Score } from "../src/score.ts";
import { render } from "../src/render.ts";
import { isSingableLyric } from "../src/events.ts";
import { alignNeutrinoPcm, CUT_FADE_SECONDS, pruneRenders } from "../src/singer/index.ts";

const sungTrack = (notes: object[]) => ({ instrument: "organ", sing: { engine: "neutrino" }, notes });
const base = (tracks: object[]) => ({ format: "jinglescript/1", tempo: 120, length: { beats: 8 }, tracks });

describe("check catches what NEUTRINO cannot sing", () => {
  it("rejects more than one sung track, with a path", () => {
    const result = checkScore(base([sungTrack([{ at: 1, pitch: "C4", lyric: "か" }]), sungTrack([{ at: 1, pitch: "E4", lyric: "か" }])]));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain("tracks[1].sing");
  });
  it("rejects non-kana and multi-mora lyrics on a sung track", () => {
    const result = checkScore(
      base([
        sungTrack([
          { at: 1, pitch: "C4", lyric: "la" },
          { at: 2, pitch: "C4", lyric: "かえる" },
        ]),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.path)).toEqual(["tracks[0].notes[0].lyric", "tracks[0].notes[1].lyric"]);
    expect(result.errors[1]?.hint).toContain("か");
  });
  it("accepts kana morae, small-kana pairs, ん, っ, _ and ー; lyrics on unsung tracks stay free", () => {
    for (const lyric of ["か", "キャ", "ん", "っ", "ぐぁ", "_", "ー"]) expect(isSingableLyric(lyric)).toBe(true);
    const result = checkScore(
      base([sungTrack([{ at: 1, pitch: "C4", lyric: "きゃ" }]), { instrument: "organ", notes: [{ at: 1, pitch: "C4", lyric: "hap-" }] }]),
    );
    expect(result.ok).toBe(true);
  });
  it("parseScore and render throw a JingleScriptError before running NEUTRINO", async () => {
    const raw = base([sungTrack([{ at: 1, pitch: "C4", lyric: "la" }]), sungTrack([{ at: 1, pitch: "C4", lyric: "か" }])]);
    expect(() => parseScore(raw)).toThrow(JingleScriptError);
    const valid = parseScore(base([sungTrack([{ at: 1, pitch: "C4", lyric: "か" }])]));
    const twoSung = { ...valid, tracks: [valid.tracks[0], valid.tracks[0]] } as Score;
    await expect(render(twoSung)).rejects.toThrow(JingleScriptError);
  });
  it("warns when a sung note starts before 0.1 s", () => {
    const result = checkScore(
      base([
        sungTrack([
          { at: 0, pitch: "C4", lyric: "さ" },
          { at: 1, pitch: "C4", lyric: "く" },
        ]),
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.path)).toEqual(["tracks[0].notes[0].at"]);
  });
});

describe("alignNeutrinoPcm", () => {
  it("fades in at the lead-in cut", () => {
    const pcm = alignNeutrinoPcm(new Float32Array(48000 * 3).fill(0.5), 48000, 48000);
    expect(pcm[0]).toBe(0);
    expect(pcm[Math.round(CUT_FADE_SECONDS * 48000)]).toBeCloseTo(0.5);
  });
});

describe("pruneRenders", () => {
  it("removes old renders and keeps the newest", () => {
    const root = mkdtempSync(join(tmpdir(), "renders-"));
    const now = Date.now();
    ["a", "b", "c", "old"].forEach((name, i) => {
      const file = join(root, `${name}.wav`);
      writeFileSync(file, "");
      const t = (name === "old" ? now - 40 * 86_400_000 : now - i * 1000) / 1000;
      utimesSync(file, t, t);
    });
    pruneRenders(root, now, 2);
    expect(readdirSync(root).sort()).toEqual(["a.wav", "b.wav"]);
  });
});
