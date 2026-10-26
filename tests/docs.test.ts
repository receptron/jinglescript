import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assSubtitles, assTime, literal, TelopsSchema } from "../docs/video/captions.ts";
import { checkScore, parseScore, render } from "../src/index.ts";
import { fixtureSamples } from "./sample-fixture.ts";

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("docs/video-sound-effects.md", () => {
  // The cue times the walk-through measured in the film; the guide's arithmetic and its frame
  // check depend on them.
  it("its score checks, with the cues at the measured times", () => {
    const result = checkScore(json("../docs/video/big-buck-bunny.json"));
    expect(result.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(result.cues).map(([name, cue]) => [name, cue.seconds]))).toEqual({
      cut: 5.5,
      bonk1: 6.625,
      bonk2: 7.25,
      bonk3: 7.583,
      bonk4: 7.833,
    });
    expect(result.duration).toBe(9.5);
  });
});

const captionsTiming = (await render(parseScore(json("../examples/lyrics-hatena.json")), { samples: fixtureSamples })).timing;

describe("docs/video/captions.ts", () => {
  const timing = captionsTiming;
  const font = { font: "Test Font" };
  const dialogues = (ass: string) => ass.split("\n").filter((line) => line.startsWith("Dialogue: "));

  it("writes ASS times as H:MM:SS.cc", () => {
    expect([0, 0.004, 1.5, 61.25, 3725.5, -1].map(assTime)).toEqual(["0:00:00.00", "0:00:00.00", "0:00:01.50", "0:01:01.25", "1:02:05.50", "0:00:00.00"]);
  });

  it("makes one karaoke line per lyric line, whose fills add up to the line and start on each syllable", () => {
    const lines = dialogues(assSubtitles(timing, [], font));
    expect(lines).toHaveLength(timing.lyrics?.length ?? 0);
    timing.lyrics?.forEach((lyric, i) => {
      const fills = [...(lines[i] ?? "").matchAll(/\{\\kf(\d+)\}([^{]*)/g)];
      expect(fills.map((f) => f[2]).join("")).toBe(lyric.text);
      const first = lyric.syllables[0]?.t ?? 0;
      const last = lyric.syllables.at(-1)?.end ?? 0;
      expect(fills.reduce((sum, f) => sum + Number(f[1]), 0)).toBe(Math.round((last - first) * 100));
    });
  });

  it("puts a telop on its cue or at its seconds, for its hold", () => {
    const lines = dialogues(
      assSubtitles(
        { ...timing, lyrics: undefined },
        TelopsSchema.parse([
          { at: "hit", text: "Hit!" },
          { at: 1.25, text: "x", hold: 2 },
        ]),
        font,
      ),
    );
    expect(lines.map((line) => line.split(",").slice(1, 4).join(","))).toEqual([
      `${assTime(timing.cues.hit ?? -1)},${assTime((timing.cues.hit ?? -1) + 0.8)},Telop`,
      "0:00:01.25,0:00:03.25,Telop",
    ]);
  });

  // What libass shows was checked by rendering: these come out as typed, and a newline breaks the line.
  it("keeps ASS commands and braces from acting, and turns a newline into a line break", () => {
    const wj = "\u2060";
    expect(literal("{\\b1}A \\N B \\h C \\\\ D")).toBe(`\\{\\${wj}b1\\}A \\${wj}N B \\${wj}h C \\${wj}\\${wj} D`);
    expect(literal("one\ntwo\r\nthree\rfour")).toBe("one\\Ntwo\\Nthree\\Nfour");
    expect(literal("ハテナ")).toBe("ハテナ");
  });

  it("writes every event on one line of the file, whatever the text holds", () => {
    const ass = assSubtitles({ ...timing, lyrics: undefined }, [{ at: 0, text: "a\nb\r\nc", hold: 1 }], font);
    const events = ass.slice(ass.indexOf("[Events]")).trim().split("\n").slice(2);
    expect(events.every((line) => line.startsWith("Dialogue: "))).toBe(true);
  });

  it("names the cues when a telop's cue does not exist", () => {
    expect(() => assSubtitles(timing, [{ at: "nope", text: "x", hold: 1 }], font)).toThrow(/no cue named "nope". Cues: hit/);
  });

  it("uses the font it is given in both styles", () => {
    expect(assSubtitles(timing, [], font).match(/^Style: \w+,Test Font,/gm)).toHaveLength(2);
  });

  it("the walk-through's telops parse and their cues exist in its score", () => {
    const telops = TelopsSchema.parse(json("../docs/video/big-buck-bunny-telops.json"));
    const cues = checkScore(json("../docs/video/big-buck-bunny.json")).cues;
    expect(telops.filter((t) => typeof t.at === "string" && !(t.at in cues))).toEqual([]);
  });
});
