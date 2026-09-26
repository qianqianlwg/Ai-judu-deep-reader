import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES, MAX_SPEECH_CHUNK, speechPlainText, speechPreferencesSchema, splitSpeechText } from "./speech";

describe("语音文本与配置边界", () => {
  it("默认配置合法，允许全部预置音色", () => {
    expect(speechPreferencesSchema.parse(DEFAULT_SPEECH_PREFERENCES).voice).toBe("mimo_default");
    expect(speechPreferencesSchema.safeParse({ ...DEFAULT_SPEECH_PREFERENCES, voice: "冰糖" }).success).toBe(true);
  });
  it.each([{ voice: "unknown" }, { playbackRate: 2.1 }, { volume: -1 }, { style: "字".repeat(501) }, { apiKey: "not-public" }])("拒绝无效配置 %j", value => {
    expect(speechPreferencesSchema.safeParse({ ...DEFAULT_SPEECH_PREFERENCES, ...value }).success).toBe(false);
  });
  it("长文按句尾分段且逐字保留，不拆开 Unicode 字符", () => {
    const text = "甲".repeat(900) + "。" + "😀".repeat(3000);
    const parts = splitSpeechText(text);
    expect(parts.join("")).toBe(text); expect(parts[0]).toBe("甲".repeat(900) + "。");
    expect(parts.every(part => Array.from(part).length <= MAX_SPEECH_CHUNK)).toBe(true);
    expect(parts.join("")).not.toContain("\ufffd");
  });
  it("拒绝空文和超长全文", () => {
    expect(() => splitSpeechText("  ")).toThrow("没有可以朗读");
    expect(() => splitSpeechText("字".repeat(30001))).toThrow("30000");
  });
  it("朗读 Markdown 正文而非链接地址、图片和代码", () => {
    expect(speechPlainText("## 标题\n**正文** [依据](https://unit.invalid)\n![图片](https://unit.invalid/a.png)\n```js\nfoo()\n```"))
      .toBe("标题\n正文 依据");
  });
});
