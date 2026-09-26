import { describe, it, expect } from "vitest";
import { translateJapanesePartName, isMeaningfulName } from "./japaneseParts";
import { hasChinese } from "./englishOnly";

describe("translateJapanesePartName (real UP-GARAGE titles)", () => {
  it.each([
    ["ホンダ (HONDA) S660 モデューロX (Modulo X) version Z 前期純正レザーステアリング", "Honda (HONDA) S660 Modulo X (Modulo X) version Z early model genuine OEM leather steering wheel"],
    ["LUNA FEGGARI ウッドコンビステアリング 【タント L375/L385 [2007/12～]】", "LUNA FEGGARI wood combination steering wheel (Tanto L375/L385 [2007/12-])"],
    ["☆ 新車外し品 ☆ トヨタ (TOYOTA) 150系ランドクルーザープラド 後期純正レザーステアリング 品番:GS120-06730", "removed from a new car Toyota (TOYOTA) 150 series Land Cruiser Prado late model genuine OEM leather steering wheel part no.:GS120-06730"],
    ["メーカー不明 ハンドルカバー", "unknown brand steering wheel cover"],
  ])("%s", (jp, en) => {
    const out = translateJapanesePartName(jp);
    expect(hasChinese(out)).toBe(false);
    expect(out).toBe(en);
  });
});

describe("isMeaningfulName", () => {
  it.each([["150", false], ["REAL &", false], ["10mm 2", false], ["MOMO F1 CONCEPT SPIDER", true], ["NARDI Classic", true], ["TOMBOY 370mm", true]])("%s -> %s", (n, ok) => {
    expect(isMeaningfulName(n)).toBe(ok);
  });
});
