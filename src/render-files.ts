// A render kept as files for other tools: the audio and its timing map, side by side under one
// stem, through whatever file access the carrier has (a GUI Chat host's workspace). A tool that
// animates to the song (an avatar singing it) is handed the two paths; nothing else about
// JingleScript needs to be known to it.
//
// The names are chosen before the render, so a render that answers before its audio exists can
// already say where the files will be; and they are never an earlier render's, so a path the
// model was given keeps playing the song it was given for. Nor are they named like another score
// ("song-2.mp3" beside a "song-2.json" that is a different song): files of one stem belong together.
import type { PlayerAudioFormat } from "./player.ts";
import { timingFileText, type TimingMap } from "./timing.ts";

/** File access a carrier gives renderScore for keeping its renders; names are file names, never paths. */
export interface RenderFiles {
  /** The path the model is told for the file `name`, whether or not it exists yet. */
  pathOf: (name: string) => string;
  exists: (name: string) => Promise<boolean>;
  write: (name: string, content: string | Uint8Array) => Promise<void>;
}

/** The two files of one render, named and held for it. */
export interface RenderSlot {
  /** Path of the audio, as the model is told it. */
  audioFile: string;
  /** Path of the timing map (jinglescript-timing/1), as the model is told it. */
  timingFile: string;
  /** The audio is written in this format: the caller encodes it so. */
  format: PlayerAudioFormat;
  /** Writes both files, then lets the stem go (the files now hold it). */
  save: (audio: Uint8Array, timing: TimingMap) => Promise<void>;
  /** Lets the stem go without writing (the render failed). */
  release: () => void;
}

/** Most stems tried for one render ("jingle", "jingle-2" … "jingle-1000") before giving up. */
const MAX_NAMES = 1000;

/** The names a render of `stem` is kept under (its audio in either format, and its timing map). */
export const renderFileNames = (stem: string): string[] => [`${stem}.mp3`, `${stem}.wav`, `${stem}.timing.json`];

/** No name is left for a render: the message tells the model what to do. */
export class RenderFilesFullError extends Error {
  constructor(stem: string) {
    super(`No free file name for the render: "${stem}" to "${stem}-${MAX_NAMES}" are all taken. Give another \`fileName\`.`);
    this.name = "RenderFilesFullError";
  }
}

/** Stems of renders still running, by the path of their audio: their files do not exist yet. */
const held = new Set<string>();

/**
 * Names the files of a render that is about to start: `<stem>.<format>` and `<stem>.timing.json`,
 * or with "-2", "-3" … when a render or a score of that stem exists or another running render
 * holds it. `ownsScore`: the score was read from `<stem>.json`, so that file does not take the stem.
 */
export async function reserveRenderFiles(files: RenderFiles, stem: string, format: PlayerAudioFormat, ownsScore: boolean): Promise<RenderSlot> {
  for (let n = 1; n <= MAX_NAMES; n++) {
    const name = n === 1 ? stem : `${stem}-${n}`;
    const key = files.pathOf(name);
    if (held.has(key)) continue;
    // Held before the first await, so two renders starting together never both take the name.
    held.add(key);
    const names = [...renderFileNames(name), ...(ownsScore && n === 1 ? [] : [`${name}.json`])];
    let taken: boolean;
    try {
      taken = (await Promise.all(names.map((file) => files.exists(file)))).some(Boolean);
    } catch (error) {
      held.delete(key);
      throw error;
    }
    if (taken) {
      held.delete(key);
      continue;
    }
    const audioName = `${name}.${format}`;
    const timingName = `${name}.timing.json`;
    return {
      audioFile: files.pathOf(audioName),
      timingFile: files.pathOf(timingName),
      format,
      save: async (audio, timing) => {
        try {
          await files.write(audioName, audio);
          await files.write(timingName, timingFileText(timing));
        } finally {
          held.delete(key);
        }
      },
      release: () => {
        held.delete(key);
      },
    };
  }
  throw new RenderFilesFullError(stem);
}
