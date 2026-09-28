import { describe, expect, it } from "vitest";
import { ANSWER_EMPHASIS_PALETTES, DEFAULT_ANSWER_EMPHASIS_PALETTE, getAnswerEmphasisPaletteVariables, isAnswerEmphasisPaletteId } from "./answer-emphasis-palette";

describe("低饱和回答重点配色", () => {
  it("提供互不混淆的四种白名单方案，非法值不能指定任意 CSS", () => {
    expect(ANSWER_EMPHASIS_PALETTES.map((palette) => palette.id)).toEqual(["paper", "sage", "blue", "mono"]);
    expect(DEFAULT_ANSWER_EMPHASIS_PALETTE).toBe("paper");
    expect(isAnswerEmphasisPaletteId("sage")).toBe(true);
    expect(isAnswerEmphasisPaletteId("url(https://example.com)")).toBe(false);
  });
  it("明暗两版都是静态低饱和色，关键句只提供线色", () => {
    for (const palette of ANSWER_EMPHASIS_PALETTES) for (const scheme of ["light", "dark"] as const) {
      const variables = getAnswerEmphasisPaletteVariables(palette.id, scheme);
      expect(Object.keys(variables)).toEqual(["--reading-term-background", "--reading-key-sentence-accent"]);
      expect(Object.values(variables).every((value) => /^#[0-9A-F]{6}$/u.test(value))).toBe(true);
    }
  });
});
