import type { Presentation } from "jinglescript";
import { describe, expect, it } from "vitest";
import { executeManage, instructionsFor } from "../src/index.ts";
import { cursorIndex, finishedMessage, FRESH_MS, memoryOf, shouldAutoplay } from "../src/vue/playback.ts";

const NOW = 1_800_000_000_000;
const asked = (fields: Partial<Presentation> = {}): Presentation => ({
  view: "notation",
  autoplay: true,
  notifyWhenDone: true,
  renderedAt: NOW - 1000,
  ...fields,
});
const fresh = memoryOf(undefined);

describe("autoplay", () => {
  it("plays a fresh render once when asked", () => {
    expect(shouldAutoplay(asked(), fresh, NOW)).toBe(true);
    expect(shouldAutoplay(asked(), { ...fresh, autoplayed: true }, NOW)).toBe(false);
    expect(shouldAutoplay(asked({ autoplay: false }), fresh, NOW)).toBe(false);
  });

  it("never plays a card shown again from history, or one from before presentation existed", () => {
    expect(shouldAutoplay(asked({ renderedAt: NOW - FRESH_MS - 1 }), fresh, NOW)).toBe(false);
    const { renderedAt: _, ...undated } = asked();
    expect(shouldAutoplay(undated, fresh, NOW)).toBe(false);
    expect(shouldAutoplay(undefined, fresh, NOW)).toBe(false);
  });
});

describe("the message when it has been heard", () => {
  it("is one line, sent once, only when asked", () => {
    expect(finishedMessage(asked(), fresh, "Twinkle", 10.84)).toBe('"Twinkle" finished playing (10.8 s): the user has heard it to the end.');
    expect(finishedMessage(asked(), { ...fresh, notified: true }, "Twinkle", 10.84)).toBeUndefined();
    expect(finishedMessage(asked({ notifyWhenDone: false }), fresh, "Twinkle", 10.84)).toBeUndefined();
  });
});

describe("memoryOf", () => {
  it("reads only what it wrote, and ignores anything else in viewState", () => {
    expect(memoryOf({ autoplayed: true, notified: "yes", view: "notation", other: 1 })).toEqual({ autoplayed: true, notified: false, view: "notation" });
    expect(memoryOf({ view: "piano roll" }).view).toBeUndefined();
  });
});

describe("cursorIndex", () => {
  it("finds the last position at or before the time", () => {
    const positions = [0, 0.6, 1.2, 1.8];
    expect([-1, 0, 0.59, 0.6, 1.5, 9].map((t) => cursorIndex(positions, t))).toEqual([0, 0, 0, 1, 2, 3]);
    expect(cursorIndex([], 1)).toBe(0);
  });
});

describe("the plugin's instructions to the LLM", () => {
  const score = {
    format: "jinglescript/1",
    title: "Scale",
    tempo: 120,
    meter: "4/4",
    length: { beats: 5 },
    tracks: [{ instrument: "marimba", notes: [{ at: 0, pitch: "C4", len: 4 }] }],
  };

  it("say what the user sees, whether it plays by itself, and to stay quiet until the message comes", async () => {
    const result = await executeManage({}, { action: "renderScore", score, view: "notation", autoplay: true, notifyWhenDone: true });
    expect(result.data?.musicxml).toContain("<score-partwise");
    expect(result.instructions).toBe(
      "The music is shown to the user as sheet music, with a cursor that follows playback. It starts playing by itself. Do not speak while it plays: say nothing until a message saying it finished playing arrives, then go on.",
    );
  });

  it("keep the old wording for a plain render", async () => {
    const result = await executeManage({}, { action: "renderScore", score });
    expect(result.instructions).toBe("The jingle is shown to the user in a player with its waveform, cues and beats. Ask whether it fits, and offer changes.");
    if (result.data) expect(instructionsFor({ ...result.data, presentation: undefined })).toContain("waveform");
  });
});
