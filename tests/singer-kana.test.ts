import { describe, expect, it } from "vitest";
import { moraPhonemes, toHiragana } from "../src/singer/index.ts";

describe("singer kana", () => {
  it("maps morae to phonemes", () => {
    expect(moraPhonemes("か")).toEqual(["k", "a"]);
    expect(moraPhonemes("カ")).toEqual(["k", "a"]);
    expect(moraPhonemes("し")).toEqual(["sh", "i"]);
    expect(moraPhonemes("きゃ")).toEqual(["ky", "a"]);
    expect(moraPhonemes("ん")).toEqual(["N"]);
    expect(moraPhonemes("あ")).toEqual(["a"]);
    expect(moraPhonemes("ふぁ")).toEqual(["f", "a"]);
    expect(moraPhonemes("abc")).toBeUndefined();
    expect(moraPhonemes("かき")).toBeUndefined();
    expect(toHiragana("マルモ")).toBe("まるも");
  });
});

describe("loanword kana", () => {
  it("maps とぅ どぅ つぁ すぃ でゅ", () => {
    expect(moraPhonemes("とぅ")).toEqual(["t", "u"]);
    expect(moraPhonemes("トゥ")).toEqual(["t", "u"]);
    expect(moraPhonemes("どぅ")).toEqual(["d", "u"]);
    expect(moraPhonemes("つぁ")).toEqual(["ts", "a"]);
    expect(moraPhonemes("すぃ")).toEqual(["s", "i"]);
    expect(moraPhonemes("でゅ")).toEqual(["dy", "u"]);
    expect(moraPhonemes("てぃ")).toEqual(["t", "i"]);
  });
});
