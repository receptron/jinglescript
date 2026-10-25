// Kana → phonemes for the singing voice. The phoneme set is the one Japanese singing corpora and
// OpenJTalk use (a i u e o N cl, consonants k g s z t d n h b p m y r w, palatalized ky gy sh j ch
// ny hy by py my ry, ts f v), so data prepared by training/singing/ and the runtime agree.

const VOWELS = ["a", "i", "u", "e", "o"] as const;

// Each row: consonant and the hiragana for a, i, u, e, o ("" where the mora does not exist).
const ROWS: readonly [string, string][] = [
  ["", "あいうえお"],
  ["k", "かきくけこ"],
  ["g", "がぎぐげご"],
  ["s", "さ　すせそ"],
  ["z", "ざ　ずぜぞ"],
  ["t", "た　　てと"],
  ["d", "だ　　でど"],
  ["n", "なにぬねの"],
  ["h", "は　　へほ"],
  ["b", "ばびぶべぼ"],
  ["p", "ぱぴぷぺぽ"],
  ["m", "まみむめも"],
  ["y", "や　ゆ　よ"],
  ["r", "らりるれろ"],
  ["w", "わ　　　を"],
];

const SINGLES: Readonly<Record<string, readonly string[]>> = {
  し: ["sh", "i"],
  じ: ["j", "i"],
  ち: ["ch", "i"],
  つ: ["ts", "u"],
  ぢ: ["j", "i"],
  づ: ["z", "u"],
  ひ: ["hy", "i"],
  ふ: ["f", "u"],
  ん: ["N"],
  っ: ["cl"],
  ゔ: ["v", "u"],
};

// Small kana that make a palatalized or foreign mora with the one before.
const SMALL: Readonly<Record<string, string>> = { ゃ: "a", ゅ: "u", ょ: "o", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o" };
const PALATAL: Readonly<Record<string, string>> = {
  き: "ky",
  ぎ: "gy",
  し: "sh",
  じ: "j",
  ち: "ch",
  に: "ny",
  ひ: "hy",
  び: "by",
  ぴ: "py",
  み: "my",
  り: "ry",
  ふ: "f",
  ゔ: "v",
  て: "t",
  で: "d",
  う: "w",
};

const MORA = new Map<string, readonly string[]>();
for (const [consonant, kana] of ROWS) {
  [...kana].forEach((char, i) => {
    const vowel = VOWELS[i];
    if (char === "　" || vowel === undefined) return;
    MORA.set(char, consonant === "" ? [vowel] : [consonant, vowel]);
  });
}
for (const [char, phonemes] of Object.entries(SINGLES)) MORA.set(char, phonemes);
MORA.set("を", ["o"]);

/** Katakana to hiragana; everything else unchanged. */
export function toHiragana(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x30a1 && code <= 0x30f4 ? String.fromCodePoint(code - 0x60) : char;
    })
    .join("");
}

/** Phonemes of one syllable (one or two kana), or undefined when it is not a Japanese mora. */
export function moraPhonemes(syllable: string): readonly string[] | undefined {
  const chars = [...toHiragana(syllable.trim())];
  const [first, second] = chars;
  if (first === undefined || chars.length > 2) return undefined;
  if (second === undefined) return MORA.get(first);
  const vowel = SMALL[second];
  const consonant = PALATAL[first];
  if (vowel === undefined || consonant === undefined) return undefined;
  // き+ゃ → ky a; but し/じ/ち already carry their palatal consonant, and ふ/ゔ/て/で/う take the vowel.
  return [consonant, vowel];
}

/** Whether a phoneme is voiced (gets F0); unvoiced consonants and the closure get 0 Hz. */
export function isVoiced(phoneme: string): boolean {
  return !["k", "ky", "s", "sh", "t", "ts", "ch", "h", "hy", "f", "p", "py", "cl", "pau"].includes(phoneme);
}
