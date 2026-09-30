import { expect, it } from "vitest";
import { DEFAULT_READING_PREFERENCES, readReadingPreferences, writeReadingPreferences, readingDifficultyPrompt, normalizeReadingDifficulty } from "./reading-preferences";
import { readingAnswerBudget } from "./reading-detail";

it("默认正常，按书隔离并可随时替换，长度和方式独立", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  expect(readReadingPreferences(storage, "a")).toEqual(DEFAULT_READING_PREFERENCES);
  writeReadingPreferences(storage, "a", { difficulty: "accessible", detail: "expanded" });
  expect(readReadingPreferences(storage, "b")).toEqual(DEFAULT_READING_PREFERENCES);
  writeReadingPreferences(storage, "a", { difficulty: "advanced", detail: "gist" });
  expect(readReadingPreferences(storage, "a")).toEqual({ difficulty: "advanced", detail: "gist" });
  expect(readingAnswerBudget("字".repeat(1000), "gist").targetCharacters).toBe(200);
  expect(readingAnswerBudget("短句", "gist").targetCharacters).toBe(40);
});
it("无效枚举归一化，损坏存储与写入失败上抛", () => {
  expect(normalizeReadingDifficulty("bad")).toBe("normal");
  expect(readReadingPreferences({ getItem: () => '{"detail":"bad","difficulty":"bad"}' }, "a")).toEqual(DEFAULT_READING_PREFERENCES);
  expect(() => readReadingPreferences({ getItem: () => "bad" }, "a")).toThrow();
  expect(() => writeReadingPreferences({ setItem: () => { throw new Error("满了"); } }, "a", DEFAULT_READING_PREFERENCES)).toThrow("满了");
});
it("通俗和深入不绑定长度", () => {
  expect(readingDifficultyPrompt("accessible")).toContain("减少术语并随文说明");
  expect(readingDifficultyPrompt("advanced")).toContain("概念边界");
  expect(readingDifficultyPrompt("normal")).toContain("解读方式与回复长度独立");
});

it('小白独立于通俗与长度，按书保存',()=>{expect(normalizeReadingDifficulty('beginner')).toBe('beginner');expect(readingDifficultyPrompt('beginner')).toContain('基础常识');expect(readingDifficultyPrompt('beginner')).toContain('具体例子');expect(readReadingPreferences({getItem:()=>JSON.stringify({difficulty:'beginner',detail:'gist'})},'book')).toEqual({difficulty:'beginner',detail:'gist'});});
