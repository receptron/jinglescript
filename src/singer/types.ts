// What the singer (NEUTRINO, neutrino.ts) receives from a score.

/** One sung note: seconds, a MIDI pitch and one kana syllable. */
export interface SingerNote {
  start: number;
  end: number;
  midi: number;
  /** One mora of hiragana or katakana, "ー"/"_" to hold the previous vowel, or "" for a rest. */
  lyric: string;
}
