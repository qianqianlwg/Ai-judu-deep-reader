// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READING_APPEARANCE as defaults, READING_APPEARANCE_STORAGE_KEYS as keys, READING_FONTS,
  applyReadingAppearanceToRoot,
  READING_THEMES, getReadingAppearanceBootstrapScript, getReadingAppearanceLayoutKey, getReadingAppearanceVariables,
  getReadingTextProps, getReadingTextStyle, getReadingThemeVariables, isReadingAppearance, migrateReadingAppearance,
  normalizeReadingAppearance, parseReadingAppearance, readReadingAppearance, serializeReadingAppearance, writeReadingAppearance,
} from "./reading-appearance";

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.readingTheme; });
afterEach(() => vi.restoreAllMocks());
describe("阅读外观纯函数与本地迁移", () => {
  it.each([undefined, null, [], "dark", 1, false, { version: 999 }])("非法输入 %j 返回独立默认对象", (input) => {
    const result = normalizeReadingAppearance(input);
    expect(result).toEqual(defaults); expect(result).not.toBe(defaults); expect(isReadingAppearance(input)).toBe(false);
  });
  it("合法偏好规范序列化、校验和反序列化，不改变输入", () => {
    const original = { ...defaults, theme: "dark" as const, font: "kai" as const, fontSize: 32, lineHeight: 2.4,
      letterSpacing: 0.08, columnWidth: "auto" as const, textAlign: "justify" as const, language: "en" as const };
    Object.freeze(original);
    expect(isReadingAppearance(original)).toBe(true);
    expect(parseReadingAppearance(serializeReadingAppearance(original))).toEqual({
      preferences: original, source: "stored", needsMigration: false, issues: [],
    });
  });
  it("有限数字钳制、量化；NaN/无穷/字符串不会进入 CSS", () => {
    expect(normalizeReadingAppearance({ fontSize: 100, lineHeight: -1, letterSpacing: 1 })).toMatchObject({ fontSize: 32, lineHeight: 1.4, letterSpacing: 0.08 });
    expect(normalizeReadingAppearance({ fontSize: 13, lineHeight: 3, letterSpacing: -1 })).toMatchObject({ fontSize: 14, lineHeight: 2.4, letterSpacing: 0 });
    expect(normalizeReadingAppearance({ fontSize: 18.4, lineHeight: 1.83, letterSpacing: 0.036 })).toMatchObject({ fontSize: 18, lineHeight: 1.8, letterSpacing: 0.04 });
    for (const invalid of [NaN, Infinity, -Infinity, "32px", "32", null]) {
      expect(normalizeReadingAppearance({ fontSize: invalid, lineHeight: invalid, letterSpacing: invalid })).toEqual(defaults);
    }
  });
  it("列宽/字体/对齐/主题/语言仅允许白名单，忽略任意注入字段", () => {
    const result = normalizeReadingAppearance({ theme: "url(https://invalid.test)", font: "evil", columnWidth: "650", textAlign: "center", language: "fr", background: "red" });
    expect(result).toEqual(defaults); expect(result).not.toHaveProperty("background");
    for (const columnWidth of [520, 650, 780, "auto"]) expect(normalizeReadingAppearance({ columnWidth }).columnWidth).toBe(columnWidth);
    for (const font of READING_FONTS) expect(normalizeReadingAppearance({ font: font.id }).font).toBe(font.id);
  });
  it.each([["0.85", 14], ["1", 16], ["1.15", 18], ["2", 32], ["100", 32], ["-1", 16], ["0", 16], ["", 16], ["Infinity", 16], ["invalid", 16]])("旧字号 %s 按 16px 基准迁移为 %s", (fontScale, fontSize) => {
    expect(migrateReadingAppearance({ theme: "paper", fontScale })).toMatchObject({ theme: "paper", fontSize });
  });
  it("旧配置只读取不删除，新存储优先；明确保存后仅写统一 key", () => {
    localStorage.setItem(keys.legacyTheme, "dark"); localStorage.setItem(keys.legacyFontScale, "1.15");
    const migrated = readReadingAppearance(localStorage);
    expect(migrated).toMatchObject({ preferences: { theme: "dark", fontSize: 18 }, source: "legacy", needsMigration: true, issues: [] });
    expect(localStorage.getItem(keys.preferences)).toBeNull();
    writeReadingAppearance(localStorage, { ...migrated.preferences, theme: "green" });
    expect(readReadingAppearance(localStorage)).toMatchObject({ preferences: { theme: "green", fontSize: 18 }, source: "stored", needsMigration: false });
    expect(localStorage.getItem(keys.legacyTheme)).toBe("dark"); expect(localStorage.getItem(keys.legacyFontScale)).toBe("1.15");
    expect(localStorage.length).toBe(3);
  });
  it("缺失字段可继承旧主题字号，其余补默认并报告纠正", () => {
    const result = parseReadingAppearance('{"lineHeight":1.8}', { theme: "dark", fontScale: "1.15" });
    expect(result).toMatchObject({ preferences: { theme: "dark", fontSize: 18, lineHeight: 1.8 }, needsMigration: true, source: "stored" });
    expect(result.issues).toHaveLength(1);
  });
  it.each(["{broken", "null", "[]", "{}", '"dark"', '{"version":2,"theme":"green"}'])("损坏或不支持的配置 %s 保留恢复原因", (raw) => {
    const result = parseReadingAppearance(raw, { theme: "paper", fontScale: "1.15" });
    expect(result).toMatchObject({ preferences: { theme: "paper", fontSize: 18 }, source: "legacy", needsMigration: true });
    expect(result.issues.length).toBeGreaterThan(0);
  });
  it("正常空设置不报告错误，非法旧值给出反馈", () => {
    expect(parseReadingAppearance(null)).toEqual({ preferences: defaults, source: "default", needsMigration: false, issues: [] });
    expect(parseReadingAppearance(null, { theme: "evil", fontScale: "oops" }).issues).toHaveLength(2);
  });
  it("存储拒绝和配额异常必须上抛，不伪装保存成功", () => {
    const failure = new Error("存储不可用");
    expect(() => readReadingAppearance({ getItem: () => { throw failure; } })).toThrow(failure);
    expect(() => writeReadingAppearance({ setItem: () => { throw failure; } }, defaults)).toThrow(failure);
  });
});
describe("根节点主题应用", () => {
  it("应用变量与 bootstrap 使用同一套主题契约，不改文档语言", () => {
    const root = document.createElement("html"); document.documentElement.lang = "zh-CN";
    const result = applyReadingAppearanceToRoot(root, { ...defaults, theme: "dark" });
    expect(result.theme).toBe("dark");
    expect(root.dataset.readingTheme).toBe("dark");
    expect(root.style.getPropertyValue("--reading-paper")).toBe("#191C1F");
    expect(root.style.getPropertyValue("--reading-font-size")).toBe("16px");
    expect(root.style.colorScheme).toBe("dark");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
describe("与可见正文和测量器共用的排版契约", () => {
  it("所有排版参数均映射到一致的 CSS/变量，阅读语言只通过 lang 传递", () => {
    const preferences = normalizeReadingAppearance({ font: "kai", fontSize: 28, lineHeight: 2.2, letterSpacing: 0.07, columnWidth: 520, textAlign: "justify", language: "en" });
    const first = getReadingTextProps(preferences); const second = getReadingTextProps({ ...preferences });
    expect(first).toEqual(second); expect(first.lang).toBe("en");
    expect(first.style).toMatchObject({ fontSize: "28px", lineHeight: 2.2, letterSpacing: "0.07em", maxWidth: "520px", width: "100%", textAlign: "justify", overflowWrap: "anywhere" });
    expect(first.style.fontFamily).toContain("KaiTi");
    const variables = getReadingAppearanceVariables(preferences);
    expect(variables["--reading-font-size"]).toBe(first.style.fontSize);
    expect(variables["--reading-font-family"]).toBe(first.style.fontFamily);
    expect(variables["--reading-column-width"]).toBe(first.style.maxWidth);
    expect(variables["--reading-line-height"]).toBe(String(first.style.lineHeight));
    expect(variables["--reading-letter-spacing"]).toBe(first.style.letterSpacing);
    expect(variables["--reading-text-align"]).toBe(first.style.textAlign);
    expect(getReadingTextStyle({ ...preferences, columnWidth: "auto" }).maxWidth).toBe("100%");
  });
  it("换色不重排，其余每个排版属性变化都产生不同的测量 key", () => {
    const baseline = getReadingAppearanceLayoutKey(defaults);
    expect(getReadingAppearanceLayoutKey({ ...defaults, theme: "dark" })).toBe(baseline);
    for (const patch of [{ font: "kai" }, { fontSize: 24 }, { lineHeight: 1.4 }, { letterSpacing: 0.08 }, { columnWidth: 780 }, { textAlign: "justify" }, { language: "en" }]) {
      expect(getReadingAppearanceLayoutKey(normalizeReadingAppearance({ ...defaults, ...patch }))).not.toBe(baseline);
    }
  });
  it("雾彩仅两侧渐变，无外部资源，所有正文面板是纯色", () => {
    for (const theme of READING_THEMES) {
      const variables = getReadingThemeVariables(theme.id);
      expect(variables["--reading-paper"]).toMatch(/^#[A-Fa-f0-9]{6}$/);
      expect(JSON.stringify(variables)).not.toMatch(/url\(|https?:|animation/);
    }
    const mist = getReadingThemeVariables("mist");
    expect(mist["--reading-sidebar-background"]).toContain("linear-gradient");
    expect(mist["--reading-assistant-background"]).toContain("linear-gradient");
  });
  it("五种主题正文、次要文字、强调色对纸面及控件底色满足 4.5:1 对比度", () => {
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    for (const theme of READING_THEMES) for (const background of [theme.paper, theme.surface]) for (const foreground of [theme.text, theme.muted, theme.accent]) {
      const light = luminance(background); const dark = luminance(foreground);
      expect((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05), theme.id + ":" + foreground).toBeGreaterThanOrEqual(4.5);
    }
  });
});
describe("首屏主题防闪脚本", () => {
  function bootstrap() { window.eval(getReadingAppearanceBootstrapScript()); }
  it.each(READING_THEMES.map((theme) => theme.id))("挂载前即设置 %s 的全部主题变量", (theme) => {
    writeReadingAppearance(localStorage, { ...defaults, theme }); bootstrap();
    expect(document.documentElement.dataset.readingTheme).toBe(theme);
    for (const [key, value] of Object.entries(getReadingThemeVariables(theme))) {
      expect(document.documentElement.style.getPropertyValue(key)).toBe(value);
    }
    expect(document.documentElement.style.colorScheme).toBe(theme === "dark" ? "dark" : "light");
  });
  it.each([null, "{}", '{"version":2}', '{"fontSize":18}', '{"theme":null}', '{"theme":"__proto__"}', '{"theme":"<script>"}'])("迁移/非法主题与主读取器规则一致：%s", (raw) => {
    localStorage.setItem(keys.legacyTheme, "dark");
    if (raw !== null) localStorage.setItem(keys.preferences, raw);
    bootstrap(); expect(document.documentElement.dataset.readingTheme).toBe(readReadingAppearance(localStorage).preferences.theme);
    expect(getReadingAppearanceBootstrapScript()).not.toContain("</script>");
  });
  it("配置损坏记录告警，存储拒绝记录错误且仍有默认主题", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem(keys.preferences, "broken"); bootstrap(); expect(warn).toHaveBeenCalledOnce();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    bootstrap(); expect(error).toHaveBeenCalledOnce(); expect(document.documentElement.dataset.readingTheme).toBe("light");
  });
});
