import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { definitionText } from "../scripts/definition.ts";
import { executeManage, pluginCore, TOOL_DEFINITION } from "../src/index.ts";
import { karaoke, lanes, waveformPath, xOf } from "../src/vue/layout.ts";
import { plugin } from "../src/vue/index.ts";

const score = {
  format: "jinglescript/1",
  title: "Plugin test",
  tempo: 120,
  length: { seconds: 3 },
  cues: { hit: { seconds: 1 } },
  tracks: [
    { instrument: "ukulele", name: "strum", notes: [{ at: 0, chord: "C", strum: "D-DU" }] },
    { instrument: "impact", notes: [{ at: "hit" }] },
  ],
};

describe("the GUI Chat Protocol plugin", () => {
  it("ships the tool definition generated from the library (run `npm run definition`)", () => {
    expect(readFileSync(new URL("../src/definition.json", import.meta.url), "utf8")).toBe(definitionText());
    expect(TOOL_DEFINITION).toMatchObject({ type: "function", name: "manageJingleScript", parameters: { type: "object", required: ["action"] } });
    expect(plugin.toolDefinition).toEqual(pluginCore.toolDefinition);
    expect(plugin.viewComponent).toBeDefined();
  });

  it("renderScore returns player data for the view and a summary for the LLM", async () => {
    const result = await executeManage({}, { action: "renderScore", score });
    expect(result.title).toBe("Plugin test");
    expect(result.data?.audio.startsWith("data:audio/")).toBe(true);
    expect(result.data?.timing.cues).toEqual({ hit: 1 });
    expect(JSON.parse(result.message)).toMatchObject({ ok: true });
  });

  it("other actions answer in text and show no card", async () => {
    const result = await executeManage({}, { action: "getGuide" });
    expect(result.data).toBeUndefined();
    expect(result.message).toContain("Writing a JingleScript score");
    expect((await executeManage({}, { action: "nope" })).message).toContain("Invalid arguments");
  });

  it("lays out lanes and the waveform", async () => {
    const result = await executeManage({}, { action: "renderScore", score });
    const data = result.data;
    if (data === undefined) throw new Error("no player data");
    const [strum, impact] = lanes(data);
    expect(strum?.notes).toHaveLength(3);
    expect(impact?.notes[0]).toMatchObject({ cue: "hit", x: xOf(1, 3) });
    expect(waveformPath([0, 1, 0.5], 50, 40)).toMatch(/^M0\.0,50\.0 L/);
  });

  it("lays out the karaoke lines: the one being sung and the next, with a wipe per syllable", () => {
    const syllable = (text: string, t: number, end: number) => ({ text, t, end });
    const lyrics = [
      { track: 0, line: 0, text: "ハテ", t: 0, end: 1, syllables: [syllable("ハ", 0, 0.5), syllable("テ", 0.5, 1)] },
      { track: 0, line: 1, text: "hap py", t: 1.5, end: 2.5, syllables: [syllable("hap ", 1.5, 2), syllable("py", 2, 2.5)] },
      { track: 0, line: 2, text: "end", t: 3, end: 3.5, syllables: [syllable("end", 3, 3.5)] },
    ];
    const at = (now: number) => karaoke(lyrics, now).map((line) => line.syllables.map((s) => `${s.text}:${s.progress}`).join("|"));
    expect(karaoke(undefined, 0)).toEqual([]);
    expect(at(-1)).toEqual(["ハ:0|テ:0", "hap :0|py:0"]);
    expect(at(0.25)).toEqual(["ハ:0.5|テ:0", "hap :0|py:0"]);
    expect(at(1.2)).toEqual(["ハ:1|テ:1", "hap :0|py:0"]);
    expect(at(2.25)).toEqual(["hap :1|py:0.5", "end:0"]);
    expect(at(9)).toEqual(["end:1"]);
  });
});
