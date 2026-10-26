import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScore } from "../src/score.ts";
import {
  findNeutrino,
  neutrinoCacheKey,
  neutrinoCandidates,
  neutrinoMusicXml,
  NeutrinoMissingError,
  NeutrinoVoiceError,
  renderWithNeutrino,
  resolveVoice,
  singTrackNeutrino,
  vocalGainDb,
  type NeutrinoExec,
} from "../src/singer/index.ts";
import { toWav } from "../src/wav.ts";

async function fakeInstall(voices = ["MERROW", "REINA"]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "neutrino-"));
  await mkdir(join(dir, "bin"));
  await writeFile(join(dir, "bin", "neutrino"), "");
  await writeFile(join(dir, "bin", "musicXMLtoLabel"), "");
  for (const voice of voices) {
    await mkdir(join(dir, "model", voice), { recursive: true });
    await writeFile(join(dir, "model", voice, "info.toml"), "");
    await writeFile(join(dir, "model", voice, "version_information.txt"), `${voice} v3.2.2`);
  }
  return dir;
}

const score = parseScore({
  format: "jinglescript/1",
  tempo: 120,
  meter: "4/4",
  length: { beats: 8 },
  tracks: [
    {
      instrument: "organ",
      notes: [
        { at: 0, pitch: "C4", len: 0.9, lyric: "か" },
        { at: 1, pitch: "C#4", len: 1, lyric: "エ" },
        { at: 3, pitch: "E4", len: 2, lyric: "る" },
        { at: 5, pitch: "D4", len: 1, lyric: "ー" },
      ],
    },
  ],
});
const notes = [
  { start: 0, end: 0.45, midi: 60, lyric: "か" },
  { start: 0.5, end: 1, midi: 61, lyric: "エ" },
  { start: 1.5, end: 2.5, midi: 64, lyric: "る" },
  { start: 2.5, end: 3, midi: 62, lyric: "ー" },
];

describe("neutrinoMusicXml", () => {
  const xml = neutrinoMusicXml(notes);
  it("starts with a bar of rest at tempo 120 and maps seconds to divisions", () => {
    expect(xml).toContain('<sound tempo="120"/>');
    expect(xml.indexOf("<rest/><duration>1920</duration>")).toBeLessThan(xml.indexOf("<step>C</step>"));
  });
  it("sings short gaps legato, writes sharps and hiragana, holds with ー", () => {
    expect(xml).toContain("<step>C</step><octave>4</octave></pitch><duration>480</duration>");
    expect(xml).toContain("<step>C</step><alter>1</alter><octave>4</octave>");
    expect(xml).toContain("<text>え</text>");
    expect(xml).toContain("<text>ー</text>");
    expect(xml).toContain("<rest/><duration>480</duration>");
  });
  it("ties a note over a barline, lyric on the first part only", () => {
    const tied = neutrinoMusicXml([{ start: 1.5, end: 2.5, midi: 64, lyric: "る" }]);
    expect(tied).toContain('<tie type="start"/>');
    expect(tied).toContain('<tie type="stop"/>');
    expect(tied.match(/<text>/g)).toHaveLength(1);
    expect(tied.match(/<measure /g)).toHaveLength(3);
  });
  it("is deterministic and escapes text", () => {
    expect(neutrinoMusicXml(notes)).toBe(xml);
    expect(neutrinoMusicXml([{ start: 0, end: 1, midi: 60, lyric: "<&>" }])).toContain("&lt;&amp;&gt;");
  });
});

describe("install detection", () => {
  it("tries NEUTRINO_DIR, /Applications, then the cache", () => {
    expect(neutrinoCandidates({ NEUTRINO_DIR: "/x", JINGLESCRIPT_CACHE: "/c" }, "/home/u")).toEqual(["/x", "/Applications/NEUTRINO", "/c/neutrino"]);
    expect(neutrinoCandidates({}, "/home/u")).toEqual(["/Applications/NEUTRINO", "/home/u/.cache/jinglescript/neutrino"]);
  });
  it("finds the first complete install and lists its voices", async () => {
    const dir = await fakeInstall();
    const install = findNeutrino(["/nonexistent", dir]);
    expect(install?.dir).toBe(dir);
    expect(install?.voices).toEqual(["MERROW", "REINA"]);
    expect(findNeutrino(["/nonexistent"])).toBeUndefined();
    if (install === undefined) return;
    expect(resolveVoice(install, "reina")).toBe("REINA");
    expect(() => resolveVoice(install, "nobody")).toThrow(NeutrinoVoiceError);
  });
});

describe("cache key", () => {
  it("changes with the score, voice, options and version", () => {
    const base = neutrinoCacheKey("<x/>", "REINA", {}, "v1");
    expect(neutrinoCacheKey("<x/>", "REINA", { transpose: 0, styleShift: 0 }, "v1")).toBe(base);
    for (const other of [
      neutrinoCacheKey("<y/>", "REINA", {}, "v1"),
      neutrinoCacheKey("<x/>", "MERROW", {}, "v1"),
      neutrinoCacheKey("<x/>", "REINA", { transpose: 2 }, "v1"),
      neutrinoCacheKey("<x/>", "REINA", { styleShift: -1 }, "v1"),
      neutrinoCacheKey("<x/>", "REINA", {}, "v2"),
    ])
      expect(other).not.toBe(base);
  });
});

describe("singTrackNeutrino (mocked NEUTRINO)", () => {
  it("runs the two tools in the install, trims the lead-in, resamples and caches", async () => {
    const dir = await fakeInstall();
    const cacheDir = await mkdtemp(join(tmpdir(), "neutrino-cache-"));
    const calls: { file: string; args: readonly string[]; cwd: string }[] = [];
    const exec: NeutrinoExec = async (file, args, _env, cwd) => {
      calls.push({ file, args, cwd });
      if (!file.endsWith("neutrino")) return;
      const pcm = new Float32Array(48000 * 3);
      pcm.fill(0.5, 96000); // silence during the 2 s lead-in, then a level
      await writeFile(args[4] ?? "", toWav([pcm, pcm], 48000, 16));
    };
    const options = { track: 0, voice: "reina", candidates: [dir], cacheDir, exec, threads: 2, transpose: 1 };
    const sung = await singTrackNeutrino(score, options, 44100);
    expect(calls.map((c) => c.file)).toEqual([join(dir, "bin", "musicXMLtoLabel"), join(dir, "bin", "neutrino")]);
    expect(calls.every((c) => c.cwd === dir)).toBe(true);
    expect(calls[1]?.args.slice(5)).toEqual([join(dir, "model", "REINA") + "/", "-n", "2", "-k", "0", "-f", "1", "-s", "48000", "-b", "16"]);
    expect(sung.voice).toBe("REINA");
    expect(sung.pcm).toHaveLength(44100);
    expect(Math.abs((sung.pcm[22050] ?? 0) - 0.5)).toBeLessThan(0.01);
    const again = await singTrackNeutrino(score, options, 44100);
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(2);
  });
  it("without NEUTRINO: throws, or warns and falls back to the built-in singer", async () => {
    await expect(renderWithNeutrino(score, { track: 0, candidates: ["/nonexistent"] })).rejects.toThrow(NeutrinoMissingError);
    const warnings: string[] = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "neutrino-cache-"));
    await expect(
      renderWithNeutrino(score, { track: 0, candidates: ["/nonexistent"], fallbackModel: "missing", cacheDir, warn: (m) => warnings.push(m) }),
    ).rejects.toThrow();
    expect(warnings[0]).toContain('built-in model "missing"');
  });
  it("renders at the render's rate: the vocal lands on its score time", async () => {
    const dir = await fakeInstall();
    const cacheDir = await mkdtemp(join(tmpdir(), "neutrino-cache-"));
    const exec: NeutrinoExec = async (file, args) => {
      if (!file.endsWith("neutrino")) return;
      const pcm = new Float32Array(48000 * 6);
      for (let i = 48000 * 3; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(i / 20); // from score time 1 s
      await writeFile(args[4] ?? "", toWav([pcm, pcm], 48000, 16));
    };
    const result = await renderWithNeutrino(score, { track: 0, candidates: [dir], cacheDir, exec, vocalLevel: null });
    expect(result.sampleRate).toBe(48000);
    const left = result.audio[0];
    const first = left.findIndex((v) => Math.abs(v) > 1e-3);
    expect(Math.abs(first - 48000)).toBeLessThan(48); // within 1 ms
  });
});

describe("vocalGainDb", () => {
  const duet = parseScore({
    format: "jinglescript/1",
    tempo: 120,
    meter: "4/4",
    length: { beats: 8 },
    tracks: [
      { instrument: "organ", gain: -2, notes: [{ at: 0, pitch: "C4", len: 8, lyric: "あ" }] },
      { instrument: "vibraphone", notes: [{ at: 0, pitch: ["C4", "E4", "G4"], len: 8 }] },
    ],
  });
  const vocal = Float32Array.from({ length: 48000 * 4 }, (_, i) => 0.01 * Math.sin((2 * Math.PI * 220 * i) / 48000));
  it("puts the vocal `level` LU over the rest, shifted by the track's gain", () => {
    const gainDb = vocalGainDb(duet, 0, vocal, {}, 4);
    const scaled = vocal.map((v) => v * 10 ** (gainDb / 20));
    // Scaled, it sits 4 + (−2) = 2 LU over the vibraphone: asking for 2 again adds only the track gain.
    expect(vocalGainDb(duet, 0, scaled, {}, 2)).toBeCloseTo(-2, 1);
  });
  it("leaves a solo vocal alone", () => {
    expect(vocalGainDb(parseScore({ ...duet, tracks: [duet.tracks[0]] } as never), 0, vocal, {}, 4)).toBe(0);
  });
});
