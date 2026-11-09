// manageJingleScript's composeScore: YuE2's plan() writes the melody and chords, compose() turns
// them into a score, and the score is saved (where the carrier keeps files) for renderScore to
// play. Composing takes 20–40 s and is not repeatable across machines, so the score it made is
// what the model keeps and edits — it never composes again to render.
import { describeFit } from "./abc-lyrics.ts";
import { AbcError } from "./abc.ts";
import { compose, Yue2Error, Yue2MissingError, type ComposeOptions } from "./compose.ts";
import { isInstrumentName } from "./instruments/index.ts";
import type { ManageInput, ManageOptions, ManageResult } from "./manage.ts";
import { checkScore, type CheckResult } from "./score.ts";

/** What composeScore's description tells the model about YuE2 (shared with the tool's schema). */
export const COMPOSE_NOTE =
  "Needs YuE2 set up on this machine (YUE2_PYTHON); its weights are CC BY-NC 4.0 (non-commercial; companies need a licence from its authors). Takes 20–40 s. Not repeatable: the same request composes differently on another machine, so keep the score it saves and render or edit that.";

const json = (value: unknown): string => JSON.stringify(value, null, 2);

function composeOptions(input: ManageInput): ComposeOptions {
  const sing = input.sing === true || input.voice !== undefined;
  return {
    style: input.style ?? "",
    lyrics: input.lyrics ?? "",
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    ...(input.section === undefined ? {} : { section: input.section }),
    ...(input.melody === undefined ? {} : { melody: input.melody }),
    ...(sing ? { sing: input.voice === undefined ? {} : { voice: input.voice } } : {}),
  };
}

/** Where the score went: a file the model passes back as `path`, or the score itself when the carrier keeps no files. */
async function saved(score: unknown, abc: string, stem: string, options: ManageOptions): Promise<Record<string, unknown>> {
  if (options.saveFile === undefined) return { score, next: "Render it: renderScore with this score (pass it as `score`)." };
  const path = await options.saveFile(`${stem}.json`, `${JSON.stringify(score, null, 2)}\n`);
  const abcFile = await options.saveFile(`${stem}.abc`, abc);
  return {
    path,
    abcFile,
    next: `Render it: renderScore with path ${JSON.stringify(path)}. To change it, read and edit that file, then checkScore and renderScore.`,
  };
}

export async function composeAction(
  input: ManageInput,
  options: ManageOptions,
  withSinger: (check: CheckResult, raw: unknown) => CheckResult,
): Promise<ManageResult> {
  if (input.melody !== undefined && !isInstrumentName(input.melody)) {
    return { text: `Unknown instrument "${input.melody}" for melody: listInstruments shows the names.`, isError: true };
  }
  let composition;
  try {
    composition = await compose(composeOptions(input));
  } catch (error) {
    if (error instanceof AbcError || error instanceof Yue2Error || error instanceof Yue2MissingError) return { text: error.message, isError: true };
    throw error;
  }
  const { score, abc, sections, lyrics, lyricsSkipped } = composition;
  const check = withSinger(checkScore(score), score);
  const summary = {
    ok: true,
    ...(await saved(score, abc, input.fileName ?? "song", options)),
    duration: check.duration,
    notes: check.notes,
    sections,
    kept: input.section ?? "the whole song (give `section` to keep one, e.g. the chorus)",
    ...(lyrics.length > 0 ? { lyrics: describeFit(lyrics).split("\n") } : {}),
    ...(lyricsSkipped === undefined ? {} : { lyricsSkipped }),
    ...(check.errors.length > 0 ? { cannotRenderYet: check.errors } : {}),
    warnings: check.warnings,
  };
  return { text: json(summary), isError: false };
}
