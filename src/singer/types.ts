// What the singer (NEUTRINO, neutrino.ts) receives from a score.

/** One sung note: seconds, a MIDI pitch and one kana syllable. */
export interface SingerNote {
  start: number;
  end: number;
  midi: number;
  /**
   * One mora of hiragana or katakana, or "ー"/"_" to hold the previous vowel. "" (no lyric) also
   * holds the vowel ("ー") right after a sung note; it is a rest only when nothing is sounding.
   */
  lyric: string;
}
