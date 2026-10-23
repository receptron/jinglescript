// Notation → MusicXML 4.0 (partwise), the file notation programs (MuseScore, Finale, Dorico) open and
// the player view draws. Text only, built by hand: no XML library, nothing that differs by machine.
import { CHORD_PATTERN } from "./chords.ts";
import { DIVISIONS, scoreToNotation, type Notation, type NotationItem, type NotationPart, type NotationStaff } from "./notation.ts";
import type { ScoreData } from "./score-schema.ts";

export const MUSICXML_MIME_TYPE = "application/vnd.recordare.musicxml+xml";

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** MusicXML's name for each chord quality the score language knows. */
const HARMONY_KINDS: Record<string, string> = {
  "": "major",
  m: "minor",
  "7": "dominant",
  maj7: "major-seventh",
  m7: "minor-seventh",
  "6": "major-sixth",
  m6: "minor-sixth",
  dim: "diminished",
  dim7: "diminished-seventh",
  aug: "augmented",
  sus2: "suspended-second",
  sus4: "suspended-fourth",
  add9: "major",
};

function harmonyXml(symbol: string, staff: number): string {
  const match = CHORD_PATTERN.exec(symbol);
  if (!match) return "";
  const [, root = "C", quality = ""] = match;
  const sharp = root[1] === "#" ? 1 : -1;
  const alter = root.length > 1 ? `<root-alter>${sharp}</root-alter>` : "";
  const degree = quality === "add9" ? "<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>" : "";
  return `<harmony><root><root-step>${root[0] ?? "C"}</root-step>${alter}</root><kind text="${escape(quality)}">${HARMONY_KINDS[quality] ?? "major"}</kind>${degree}<staff>${staff}</staff></harmony>`;
}

function noteXml(item: NotationItem, staff: number): string {
  const voice = `<voice>${staff}</voice>`;
  if (item.pitches.length === 0) {
    const value = item.value;
    if (item.measureRest || value === undefined)
      return `<note><rest measure="yes"/><duration>${item.duration}</duration>${voice}<staff>${staff}</staff></note>`;
    return `<note><rest/><duration>${item.duration}</duration>${voice}${typeXml(item)}<staff>${staff}</staff>${notationsXml(item, false)}</note>`;
  }
  return item.pitches
    .map((pitch, i) => {
      const alter = pitch.alter === 0 ? "" : `<alter>${pitch.alter}</alter>`;
      const ties = `${item.tieStop ? '<tie type="stop"/>' : ""}${item.tieStart ? '<tie type="start"/>' : ""}`;
      const accidental = item.accidentals[i] === undefined ? "" : `<accidental>${item.accidentals[i]}</accidental>`;
      const lyric = i === 0 && item.lyric ? lyricXml(item.lyric) : "";
      return [
        "<note>",
        i > 0 ? "<chord/>" : "",
        `<pitch><step>${pitch.step}</step>${alter}<octave>${pitch.octave}</octave></pitch>`,
        `<duration>${item.duration}</duration>`,
        ties,
        voice,
        typeXml(item, accidental),
        `<staff>${staff}</staff>`,
        notationsXml(item, true, i === 0),
        lyric,
        "</note>",
      ].join("");
    })
    .join("");
}

/** <type>, <dot>s, the accidental and a triplet's time modification, in MusicXML's order. */
function typeXml(item: NotationItem, accidental = ""): string {
  const value = item.value;
  if (value === undefined) return accidental;
  const dots = "<dot/>".repeat(value.dots);
  const modification = value.triplet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : "";
  return `<type>${value.type}</type>${dots}${accidental}${modification}`;
}

function notationsXml(item: NotationItem, pitched: boolean, first = true): string {
  const parts = [
    pitched && item.tieStop ? '<tied type="stop"/>' : "",
    pitched && item.tieStart ? '<tied type="start"/>' : "",
    first && item.tuplet !== undefined ? `<tuplet type="${item.tuplet}" bracket="yes"/>` : "",
  ].join("");
  return parts === "" ? "" : `<notations>${parts}</notations>`;
}

function lyricXml(lyric: NonNullable<NotationItem["lyric"]>): string {
  return `<lyric number="1"><syllabic>${lyric.syllabic}</syllabic><text>${escape(lyric.text)}</text>${lyric.extend ? "<extend/>" : ""}</lyric>`;
}

const CLEF_XML = { treble: "<sign>G</sign><line>2</line>", bass: "<sign>F</sign><line>4</line>" } as const;

function attributesXml(notation: Notation, part: NotationPart): string {
  const staves = part.staves.length > 1 ? `<staves>${part.staves.length}</staves>` : "";
  const clefs = part.staves.map((staff, i) => `<clef number="${i + 1}">${CLEF_XML[staff.clef]}</clef>`).join("");
  return [
    "<attributes>",
    `<divisions>${DIVISIONS}</divisions>`,
    `<key><fifths>${notation.key.fifths}</fifths><mode>${notation.key.mode}</mode></key>`,
    `<time><beats>${notation.meter.beats}</beats><beat-type>${notation.meter.beatType}</beat-type></time>`,
    staves,
    clefs,
    "</attributes>",
  ].join("");
}

function tempoXml(tempo: number): string {
  const rounded = Math.round(tempo * 100) / 100;
  return `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${rounded}</per-minute></metronome></direction-type><sound tempo="${rounded}"/></direction>`;
}

function staffMeasureXml(staff: NotationStaff, index: number, number: number): string {
  return (staff.measures[index] ?? []).map((item) => `${item.harmony === undefined ? "" : harmonyXml(item.harmony, number)}${noteXml(item, number)}`).join("");
}

function partXml(notation: Notation, part: NotationPart, first: boolean): string {
  const measures = notation.measures.map((measure, index) => {
    const tempo = first ? tempoXml(notation.tempo) : "";
    const head = index === 0 ? `${attributesXml(notation, part)}${tempo}` : "";
    const staves = part.staves.map((staff, s) => staffMeasureXml(staff, index, s + 1)).join(`<backup><duration>${measure.length}</duration></backup>`);
    const last = index === notation.measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : "";
    return `<measure number="${measure.number}"${measure.implicit ? ' implicit="yes"' : ""}>${head}${staves}${last}</measure>`;
  });
  return `<part id="${part.id}">${measures.join("\n")}</part>`;
}

/** MusicXML for notation already built. */
export function notationToMusicXml(notation: Notation): string {
  const identification = [
    notation.composer === undefined ? "" : `<creator type="composer">${escape(notation.composer)}</creator>`,
    notation.rights === undefined ? "" : `<rights>${escape(notation.rights)}</rights>`,
    "<encoding><software>JingleScript</software></encoding>",
  ].join("");
  const partList = notation.parts.map((part) => `<score-part id="${part.id}"><part-name>${escape(part.name)}</part-name></score-part>`).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    notation.title === undefined ? "" : `<work><work-title>${escape(notation.title)}</work-title></work>`,
    `<identification>${identification}</identification>`,
    `<part-list>${partList}</part-list>`,
    ...notation.parts.map((part, i) => partXml(notation, part, i === 0)),
    "</score-partwise>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n");
}

/** MusicXML for a valid score, or undefined when it has nothing to put on a staff (only sound effects). */
export function scoreToMusicXml(score: ScoreData): string | undefined {
  const notation = scoreToNotation(score);
  return notation === undefined ? undefined : notationToMusicXml(notation);
}
