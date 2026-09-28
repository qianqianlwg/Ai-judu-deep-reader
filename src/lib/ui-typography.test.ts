import { describe, expect, it } from "vitest";
import { applyUiTextSize, DEFAULT_UI_TEXT_SIZE, normalizeUiTextSize, uiTextSizeBootstrapScript } from "./ui-typography";

describe("非正文字号偏好", () => {
  it.each([undefined, null, "", "invalid", 0, 21, 13.5])("无效值 %j 回退默认", value => {
    expect(normalizeUiTextSize(value)).toBe(DEFAULT_UI_TEXT_SIZE);
  });
  it("允许 11–20px 且互不影响正文 CSS 变量", () => {
    const style = new Map<string, string>();
    const target = { style: { setProperty: (key: string, value: string) => style.set(key, value) } } as unknown as HTMLElement;
    expect(applyUiTextSize(target, "18")).toBe(18);
    expect(style.get("--ui-text-size")).toBe("18px");
    expect(style.get("--ui-small-size")).toBe("16px");
    expect(style.has("--reading-font-size")).toBe(false);
  });
  it("首屏脚本仅写非正文变量且不含外部脚本", () => {
    expect(uiTextSizeBootstrapScript()).toContain("--ui-text-size");
    expect(uiTextSizeBootstrapScript()).not.toContain("--reading-font-size");
    expect(uiTextSizeBootstrapScript()).not.toMatch(/https?:\/\//u);
  });
});
