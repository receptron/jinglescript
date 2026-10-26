import { describe, expect, it } from "vitest";
import { parseScore } from "../src/score.ts";
import { render } from "../src/render.ts";

const SR = 44100;

// Track 0 (the one under test) panned as given; track 1 a hard-right reference at unit gain.
function twoTracks(track: Record<string, unknown>, note: Record<string, unknown> = {}) {
  const notes = (extra: Record<string, unknown>) => [{ at: 0, pitch: "A4", len: 1, ...extra }];
  return parseScore({
    format: "jinglescript/1",
    tempo: 120,
    length: { beats: 2 },
    master: { reverb: "none", limiter: false },
    tracks: [
      { instrument: "organ", pan: 0, ...track, notes: notes(note) },
      { instrument: "organ", pan: 1, notes: notes({}) },
    ],
  });
}

const sumAbs = (x: Float32Array) => x.reduce((s, v) => s + Math.abs(v), 0);

describe("prerendered tracks follow the track's pan, gain and dynamics", () => {
  const pcm = Float32Array.from({ length: SR }, (_, i) => 0.1 * Math.sin(i / 10));
  /** Level of track 0 relative to the reference. */
  const level = (track: Record<string, unknown>, note?: Record<string, unknown>) => {
    const [left, right] = render(twoTracks(track, note), {
      prerendered: new Map([
        [0, pcm],
        [1, pcm],
      ]),
    }).audio;
    return sumAbs(left) / sumAbs(right);
  };

  it("pans like an instrument", () => {
    expect(level({})).toBeCloseTo(1, 3);
    expect(level({ pan: 1 })).toBeLessThan(1e-6);
  });

  it("applies the track gain and the note velocity", () => {
    expect(level({ gain: -6 })).toBeCloseTo(0.501, 2);
    expect(level({}, { vel: 0.4 })).toBeCloseTo(0.5, 2);
  });
});
