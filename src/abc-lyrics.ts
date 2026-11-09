// Putting the lyrics YuE2 was given onto the melody it planned. YuE2's ABC carries no words, but
// its melody follows them: one note per mora, a phrase (notes between rests) per lyric line or
// chunk, lines repeated when the song repeats a section. So: split the melody into phrases, give
// each phrase the run of lyric chunks whose mora count is nearest its note count, and make the
// counts agree — extra notes hold the last mora, missing notes come from splitting the longest.
import { AbcError, sectionNames, type AbcNote, type ParsedAbc } from "./abc.ts";
import { moraPhonemes, toHiragana } from "./singer/kana.ts";

const SMALL_KANA = new Set([..."ゃゅょぁぃぅぇぉゎ"]);
const HOLD = new Set(["ー", "〜", "~"]);
// Chunk breaks inside a line.
const BREAKS = /[\s、。，．,.!！?？・「」『』()（）]+/;

/** "ハテナマルモ" → ["ハ","テ","ナ","マ","ル","モ"]; "きゃっと" → ["きゃ","っ","と"]; "ー" holds. Kana only. */
export function splitMorae(text: string): string[] {
  const morae: string[] = [];
  for (const char of text) {
    const kana = toHiragana(char);
    const last = morae.at(-1);
    if (SMALL_KANA.has(kana) && last !== undefined && moraPhonemes(last + char) !== undefined) {
      morae[morae.length - 1] = last + char;
    } else if (HOLD.has(char)) {
      morae.push("ー");
    } else if (moraPhonemes(char) !== undefined) {
      morae.push(char);
    } else {
      throw new AbcError(
        `"${char}" in the lyrics "${text}" is not kana. Singing (NEUTRINO) needs the words in hiragana or katakana, one mora per note: write "${text}" in kana.`,
      );
    }
  }
  return morae;
}

interface LyricSection {
  /** Normalized like a cue name ("chorus", "pre_chorus"); "" for words before any tag. */
  label: string;
  chunks: { morae: string[]; text: string; lineEnd: boolean }[];
}

const normalize = (label: string): string =>
  label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== "")
    .join("_");

/** YuE2-style lyrics ("[Verse]\nline\nline\n\n[Chorus]\n…") as sections of mora chunks. */
export function parseLyrics(lyrics: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: LyricSection | undefined;
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = /^\[([^\]]+)\]$/.exec(line);
    if (tag) {
      current = { label: normalize(tag[1] ?? ""), chunks: [] };
      sections.push(current);
      continue;
    }
    const parts = line.split(BREAKS).filter((part) => part !== "");
    if (parts.length === 0) continue;
    if (current === undefined) {
      current = { label: "", chunks: [] };
      sections.push(current);
    }
    for (const [i, part] of parts.entries()) current.chunks.push({ morae: splitMorae(part), text: part, lineEnd: i === parts.length - 1 });
  }
  return sections.filter((section) => section.chunks.length > 0);
}

export interface PhraseFit {
  /** Beat (in the ABC) where the phrase starts. */
  at: number;
  notes: number;
  morae: number;
  /** The words given to it. */
  text: string;
  /** "exact"; "held" (more notes than morae: the last mora is held); "split" (notes were split); "dropped" (morae left over). */
  fit: "exact" | "held" | "split" | "dropped";
  /** Index of the ABC section it belongs to (that of its last note: a pickup belongs to what it leads into). */
  section: number;
}

export interface LyricsFit {
  parsed: ParsedAbc;
  phrases: PhraseFit[];
}

/** Groups of notes with no rest between them. */
function phrasesOf(notes: AbcNote[]): AbcNote[][] {
  const phrases: AbcNote[][] = [];
  let end = -Infinity;
  for (const note of notes) {
    const last = phrases.at(-1);
    if (last === undefined || note.at > end + 1e-9) phrases.push([note]);
    else last.push(note);
    end = note.at + note.len;
  }
  return phrases;
}

/** The lyric section each ABC section sings: same label (its n-th occurrence, else the last), else all the words when there is one section. */
function lyricsForSection(label: string, occurrence: number, sections: LyricSection[]): LyricSection | undefined {
  const same = sections.filter((section) => section.label === normalize(label));
  if (same.length > 0) return same[Math.min(occurrence, same.length - 1)];
  if (sections.length === 1) return sections[0];
  const untagged = sections.filter((section) => section.label === "");
  return untagged.length === 1 ? untagged[0] : undefined;
}

/** Splits the longest note in two (same pitch) until there are `count`; undefined when notes get too short. */
function splitTo(notes: AbcNote[], count: number): AbcNote[] | undefined {
  const out = [...notes];
  while (out.length < count) {
    let longest = 0;
    for (const [i, note] of out.entries()) if (note.len > (out[longest]?.len ?? 0)) longest = i;
    const note = out[longest];
    if (note === undefined || note.len < 0.25) return undefined;
    const half = note.len / 2;
    out.splice(longest, 1, { ...note, len: half }, { ...note, at: note.at + half, len: half });
  }
  return out;
}

function fitPhrase(notes: AbcNote[], morae: string[]): { notes: AbcNote[]; fit: PhraseFit["fit"] } {
  if (notes.length === morae.length) return { notes: notes.map((note, i) => ({ ...note, lyric: morae[i] })), fit: "exact" };
  if (notes.length > morae.length) {
    const lyricAt = (i: number): string => (i < morae.length ? (morae[i] ?? "_") : "_");
    return { notes: notes.map((note, i) => ({ ...note, lyric: lyricAt(i) })), fit: "held" };
  }
  const split = splitTo(notes, morae.length);
  if (split !== undefined) return { notes: split.map((note, i) => ({ ...note, lyric: morae[i] })), fit: "split" };
  return { notes: notes.map((note, i) => ({ ...note, lyric: morae[i] })), fit: "dropped" };
}

interface Cursor {
  section: LyricSection;
  next: number;
}

/**
 * Takes the run of chunks from the cursor (cycling) whose mora count is nearest `count`. Ending
 * mid-line costs half a mora, running on past a line end costs a mora and a half: a phrase takes a
 * whole line, or two only when that fits clearly better.
 */
function takeChunks(cursor: Cursor, count: number): { morae: string[]; text: string } {
  const { chunks } = cursor.section;
  let best = { cost: Infinity, take: 1 };
  let morae = 0;
  let crossed = 0;
  for (let take = 1; take <= Math.min(4, chunks.length); take += 1) {
    const chunk = chunks[(cursor.next + take - 1) % chunks.length];
    if (take > 1 && chunks[(cursor.next + take - 2) % chunks.length]?.lineEnd) crossed += 1;
    morae += chunk?.morae.length ?? 0;
    const cost = Math.abs(count - morae) + (chunk?.lineEnd ? 0 : 0.5) + 1.5 * crossed;
    if (cost < best.cost) best = { cost, take };
  }
  const taken = Array.from({ length: best.take }, (_, i) => chunks[(cursor.next + i) % chunks.length]);
  cursor.next = (cursor.next + best.take) % chunks.length;
  return { morae: taken.flatMap((chunk) => chunk?.morae ?? []), text: taken.map((chunk) => chunk?.text ?? "").join(" ") };
}

/** The ABC with `lyrics` on the notes of `voice` (default "Vocal"), and how each phrase fitted. */
export function fitLyrics(parsed: ParsedAbc, lyrics: string, voice = "Vocal"): LyricsFit {
  const sections = parseLyrics(lyrics);
  if (sections.length === 0) throw new AbcError("the lyrics have no words");
  const seen = new Map<string, number>();
  const occurrences = parsed.sections.map((section) => {
    const n = seen.get(normalize(section.label)) ?? 0;
    seen.set(normalize(section.label), n + 1);
    return n;
  });
  // A phrase belongs to the section its last note is in (a pickup belongs to what it leads into).
  const sectionAt = (beat: number): number => parsed.sections.filter((section) => section.at <= beat + 1e-9).length - 1;
  const cursors = new Map<number, Cursor | undefined>();
  const cursorFor = (index: number): Cursor | undefined => {
    if (!cursors.has(index)) {
      const label = parsed.sections[index]?.label ?? "";
      const section = lyricsForSection(label, occurrences[index] ?? 0, sections) ?? (index < 0 ? sections[0] : undefined);
      cursors.set(index, section === undefined ? undefined : { section, next: 0 });
    }
    return cursors.get(index);
  };
  const phrases: PhraseFit[] = [];
  const notes: AbcNote[] = [];
  for (const phrase of phrasesOf(parsed.voices[voice] ?? [])) {
    const last = phrase.at(-1);
    const index = sectionAt(last?.at ?? 0);
    const cursor = cursorFor(index);
    if (cursor === undefined || last === undefined) {
      notes.push(...phrase);
      continue;
    }
    const words = takeChunks(cursor, phrase.length);
    const fitted = fitPhrase(phrase, words.morae);
    const end = fitted.notes.at(-1);
    if (end !== undefined) end.lineEnd = true;
    notes.push(...fitted.notes);
    phrases.push({ at: phrase[0]?.at ?? 0, notes: phrase.length, morae: words.morae.length, text: words.text, fit: fitted.fit, section: index });
  }
  return { parsed: { ...parsed, voices: { ...parsed.voices, [voice]: notes } }, phrases };
}

export interface PlacedLyrics {
  parsed: ParsedAbc;
  /** How each phrase took its words; empty when they were not placed. */
  phrases: PhraseFit[];
  /** Why the words were not placed (not kana, and nothing is sung). */
  skipped?: string;
}

/**
 * fitLyrics when the words are kana. When they are not, a sung score is an error (NEUTRINO needs
 * kana) and a played one simply goes without words.
 */
export function placeLyrics(parsed: ParsedAbc, lyrics: string | undefined, sing: boolean): PlacedLyrics {
  if (lyrics === undefined || lyrics.trim() === "") {
    if (sing) throw new AbcError("singing needs lyrics: give the words (in kana) that the melody was written for");
    return { parsed, phrases: [] };
  }
  try {
    return fitLyrics(parsed, lyrics);
  } catch (error) {
    if (sing || !(error instanceof AbcError)) throw error;
    return { parsed, phrases: [], skipped: error.message };
  }
}

/** The phrases of one section (a cue name from sectionNames), or all of them without one. */
export function phrasesIn(phrases: PhraseFit[], parsed: ParsedAbc, section: string | undefined): PhraseFit[] {
  if (section === undefined) return phrases;
  const index = sectionNames(parsed).indexOf(section);
  return phrases.filter((phrase) => phrase.section === index);
}

/** One line per phrase, e.g. "  beat 12: 11 notes ← ハテナマルモ はじまるよ (11 morae)", plus a count. */
export function describeFit(phrases: PhraseFit[]): string {
  const counts = phrases.reduce<Record<string, number>>((all, phrase) => ({ ...all, [phrase.fit]: (all[phrase.fit] ?? 0) + 1 }), {});
  const summary = Object.entries(counts)
    .map(([fit, n]) => `${n} ${fit}`)
    .join(", ");
  const lines = phrases.map((phrase) => {
    const note = phrase.fit === "exact" ? "" : ` [${phrase.fit}]`;
    return `  beat ${Math.round(phrase.at * 100) / 100}: ${phrase.notes} notes ← ${phrase.text} (${phrase.morae} morae)${note}`;
  });
  return [`lyrics on ${phrases.length} phrases: ${summary}`, ...lines].join("\n");
}
