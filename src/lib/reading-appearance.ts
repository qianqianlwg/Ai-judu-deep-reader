import type { CSSProperties } from "react";

export const READING_APPEARANCE_STORAGE_KEYS = Object.freeze({
  preferences: "judu:readingAppearance:v1",
  legacyTheme: "judu:theme",
  legacyFontScale: "judu:fontScale",
});

export type ReadingThemeId = "gray" | "light" | "paper" | "green" | "dark" | "mist";
export type ReadingFontId = "song" | "hei" | "kai" | "serif" | "sans";
export type ReadingColumnWidth = 520 | 650 | 780 | "auto";
export type ReadingLanguage = "zh-CN" | "en";
export interface ReadingAppearancePreferences {
  version: 1;
  theme: ReadingThemeId;
  font: ReadingFontId;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  columnWidth: ReadingColumnWidth;
  textAlign: "left" | "justify";
  language: ReadingLanguage;
}

export const DEFAULT_READING_APPEARANCE: Readonly<ReadingAppearancePreferences> = Object.freeze({
  version: 1, theme: "gray", font: "song", fontSize: 16, lineHeight: 2,
  letterSpacing: 0, columnWidth: 650, textAlign: "left", language: "zh-CN",
});
export const READING_APPEARANCE_LIMITS = Object.freeze({
  fontSize: { min: 14, max: 32, step: 1 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.1 },
  letterSpacing: { min: 0, max: 0.08, step: 0.01 },
});
export const READING_COLUMN_WIDTHS = [520, 650, 780, "auto"] as const;
export const READING_FONTS: ReadonlyArray<{ id: ReadingFontId; label: string; family: string }> = [
  { id: "song", label: "宋体", family: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif' },
  { id: "hei", label: "黑体", family: '"PingFang SC", "Microsoft YaHei", "SimHei", "Noto Sans CJK SC", sans-serif' },
  { id: "kai", label: "楷体", family: '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif' },
  { id: "serif", label: "系统衬线", family: 'ui-serif, Georgia, "Times New Roman", "Songti SC", "SimSun", serif' },
  { id: "sans", label: "无衬线", family: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
];
export interface ReadingTheme {
  id: ReadingThemeId;
  label: string;
  description: string;
  scheme: "light" | "dark";
  paper: string;
  sidebar: string;
  assistant: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  selected: string;
}
export const READING_THEMES: ReadonlyArray<ReadingTheme> = [
  { id: "gray", label: "灰白（默认）", description: "白色正文 · 中性灰侧栏", scheme: "light",
    paper: "#FFFFFF", sidebar: "#F1F2F3", assistant: "#F7F7F8", surface: "#FFFFFF",
    text: "#292D32", muted: "#626870", border: "#D9DCE0", accent: "#495666", selected: "#E3E6EA" },
  { id: "light", label: "浅绿", description: "暖白正文 · 灰青侧栏", scheme: "light",
    paper: "#FFFDF9", sidebar: "#EEF4F2", assistant: "#F7FAF9", surface: "#FFFFFF",
    text: "#263238", muted: "#5D6A6C", border: "#D7E2E0", accent: "#396E6A", selected: "#DDEBE7" },
  { id: "paper", label: "纸张", description: "米色纸面 · 温暖柔和", scheme: "light",
    paper: "#FBF4E7", sidebar: "#EEE4D3", assistant: "#F5ECDD", surface: "#FFF9EF",
    text: "#42382E", muted: "#76634F", border: "#D8CBB6", accent: "#825F36", selected: "#EADBC1" },
  { id: "green", label: "护眼绿", description: "浅绿纸面 · 低饱和度", scheme: "light",
    paper: "#EFF5EC", sidebar: "#E2EBDE", assistant: "#E9F0E5", surface: "#F6FAF3",
    text: "#2D3D30", muted: "#5D705D", border: "#C6D5C1", accent: "#426C49", selected: "#D6E5D1" },
  { id: "dark", label: "深色", description: "炭灰纸面 · 柔白文字", scheme: "dark",
    paper: "#191C1F", sidebar: "#22272B", assistant: "#202528", surface: "#2B3236",
    text: "#E3E7E6", muted: "#ADBAB7", border: "#4C5A5A", accent: "#A1C9BF", selected: "#314A46" },
  // WHY：雾彩只在两侧使用静态渐变，正文纯色；不监听屏幕坐标，也不伪装客户端壁纸透射。
  { id: "mist", label: "雾彩", description: "两侧淡彩 · 纯色正文", scheme: "light",
    paper: "#FFFDFB", sidebar: "linear-gradient(135deg, #EDF5F4 0%, #F1EDF8 47%, #FAEFF1 100%)",
    assistant: "linear-gradient(155deg, #F0F5FB 0%, #F6F0F7 50%, #EDF6F1 100%)", surface: "#FFFFFF",
    text: "#303540", muted: "#636A79", border: "#DADDE8", accent: "#626498", selected: "#E9E7F5" },
];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function numeric(value: unknown, key: keyof typeof READING_APPEARANCE_LIMITS): number {
  const { min, max, step } = READING_APPEARANCE_LIMITS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_READING_APPEARANCE[key];
  return Number((min + Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step).toFixed(2));
}
export function normalizeReadingAppearance(value: unknown): ReadingAppearancePreferences {
  const item = record(value);
  if (item.version !== undefined && item.version !== 1) return { ...DEFAULT_READING_APPEARANCE };
  return {
    version: 1,
    theme: READING_THEMES.find((theme) => theme.id === item.theme)?.id ?? DEFAULT_READING_APPEARANCE.theme,
    font: READING_FONTS.find((font) => font.id === item.font)?.id ?? DEFAULT_READING_APPEARANCE.font,
    fontSize: numeric(item.fontSize, "fontSize"), lineHeight: numeric(item.lineHeight, "lineHeight"),
    letterSpacing: numeric(item.letterSpacing, "letterSpacing"),
    columnWidth: READING_COLUMN_WIDTHS.find((width) => width === item.columnWidth) ?? DEFAULT_READING_APPEARANCE.columnWidth,
    textAlign: item.textAlign === "justify" ? "justify" : "left",
    language: item.language === "en" ? "en" : "zh-CN",
  };
}
export function isReadingAppearance(value: unknown): value is ReadingAppearancePreferences {
  const item = record(value);
  const normalized = normalizeReadingAppearance(value);
  const keys = ["version", "theme", "font", "fontSize", "lineHeight", "letterSpacing", "columnWidth", "textAlign", "language"];
  return Object.keys(item).every((key) => keys.includes(key)) && keys.every((key) => item[key] === normalized[key as keyof ReadingAppearancePreferences]);
}
export interface LegacyReadingAppearance { theme?: string | null; fontScale?: string | null }
export function migrateReadingAppearance(legacy: LegacyReadingAppearance): ReadingAppearancePreferences {
  const rawScale = legacy.fontScale?.trim();
  const scale = rawScale ? Number(rawScale) : NaN;
  // WHY：旧阅读器以 16px × fontScale 排版；按这个基准迁移，不能当成新字号直接使用。
  return normalizeReadingAppearance({ theme: legacy.theme,
    fontSize: Number.isFinite(scale) && scale > 0 ? 16 * scale : undefined });
}
export interface ReadingAppearanceReadResult {
  preferences: ReadingAppearancePreferences;
  source: "stored" | "legacy" | "default";
  needsMigration: boolean;
  issues: string[];
}
/** 纯读取：解析字符串及旧设置快照，不访问浏览器、不写入或删除旧数据。 */
export function parseReadingAppearance(raw: string | null, legacy: LegacyReadingAppearance = {}): ReadingAppearanceReadResult {
  const issues: string[] = [];
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const item = record(parsed);
      if (item.version !== undefined && item.version !== 1) {
        issues.push("阅读外观版本不受支持，已回退到旧设置或默认值。");
      } else if (Object.keys(item).length === 0) {
        issues.push("阅读外观数据为空或格式不正确，已回退到旧设置或默认值。");
      } else {
        const preferences = normalizeReadingAppearance({ ...migrateReadingAppearance(legacy), ...item });
        const corrected = !isReadingAppearance(parsed);
        if (corrected) issues.push("阅读外观包含缺失或非法值，已补全并校正到可用范围。");
        return { preferences, source: "stored", needsMigration: corrected, issues };
      }
    } catch {
      // WHY：本地 JSON 损坏不阻塞阅读，但必须将恢复原因交给界面，不静默掩盖异常。
      issues.push("无法解析已保存的阅读外观，已回退到旧设置或默认值。");
    }
  }
  const hasLegacy = legacy.theme != null || legacy.fontScale != null;
  const preferences = migrateReadingAppearance(legacy);
  if (legacy.theme != null && !READING_THEMES.some((theme) => theme.id === legacy.theme)) {
    issues.push("旧主题无效，已使用默认主题。");
  }
  if (legacy.fontScale != null && (!legacy.fontScale.trim() || !Number.isFinite(Number(legacy.fontScale)) || Number(legacy.fontScale) <= 0)) {
    issues.push("旧字号无效，已使用默认字号。");
  }
  return { preferences, source: hasLegacy ? "legacy" : "default", needsMigration: hasLegacy || raw !== null, issues };
}
/** 纯写入：返回规范 JSON，由组合根决定何时以及保存到何处。 */
export function serializeReadingAppearance(value: unknown): string {
  return JSON.stringify(normalizeReadingAppearance(value));
}
export type ReadingAppearanceStorage = Pick<Storage, "getItem" | "setItem">;
export function readReadingAppearance(storage: Pick<ReadingAppearanceStorage, "getItem">): ReadingAppearanceReadResult {
  // WHY：localStorage 只有同步 API；注入存储适配器便于测试，拒绝访问等异常上抛给宿主反馈。
  return parseReadingAppearance(storage.getItem(READING_APPEARANCE_STORAGE_KEYS.preferences), {
    theme: storage.getItem(READING_APPEARANCE_STORAGE_KEYS.legacyTheme),
    fontScale: storage.getItem(READING_APPEARANCE_STORAGE_KEYS.legacyFontScale),
  });
}
export function writeReadingAppearance(storage: Pick<ReadingAppearanceStorage, "setItem">, value: unknown): ReadingAppearancePreferences {
  const preferences = normalizeReadingAppearance(value);
  storage.setItem(READING_APPEARANCE_STORAGE_KEYS.preferences, serializeReadingAppearance(preferences));
  return preferences;
}

export type ReadingAppearanceVariables = Record<`--reading-${string}` | `--ui-${string}`, string>;
export function getReadingThemeVariables(themeId: ReadingThemeId): ReadingAppearanceVariables {
  const theme = READING_THEMES.find((item) => item.id === themeId) ?? READING_THEMES[0];
  return {
    "--reading-paper": theme.paper, "--reading-text": theme.text, "--reading-muted": theme.muted,
    "--reading-border": theme.border, "--reading-accent": theme.accent, "--reading-selected": theme.selected,
    "--reading-sidebar-background": theme.sidebar, "--reading-assistant-background": theme.assistant,
    "--reading-surface": theme.surface, "--reading-color-scheme": theme.scheme,
    // WHY：旧版工作台样式仍使用 --ui-* 变量；在同一主题变量包中提供兼容别名，避免正文换色而三栏外壳停留在硬编码浅色。
    "--ui-bg": theme.paper, "--ui-panel": theme.sidebar, "--ui-panel-deep": theme.surface,
    "--ui-border": theme.border, "--ui-text": theme.text,
    "--ui-subtle": theme.muted, "--ui-accent": theme.accent,
  };
}
/** 可见正文和隐藏测量器须用同一结果、同一可用容器宽度；挂载后先等 fonts.ready 再测量。 */
export function getReadingTextStyle(value: ReadingAppearancePreferences): CSSProperties {
  const preferences = normalizeReadingAppearance(value);
  return {
    fontFamily: READING_FONTS.find((font) => font.id === preferences.font)!.family,
    fontSize: preferences.fontSize + "px", lineHeight: preferences.lineHeight,
    letterSpacing: preferences.letterSpacing + "em", textAlign: preferences.textAlign,
    width: "100%", maxWidth: preferences.columnWidth === "auto" ? "100%" : preferences.columnWidth + "px",
    marginInline: "auto", fontWeight: 400, fontStyle: "normal",
    whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "normal", hyphens: "manual",
  };
}
export function applyReadingAppearanceToRoot(target: HTMLElement, value: ReadingAppearancePreferences): ReadingAppearancePreferences {
  const preferences = normalizeReadingAppearance(value);
  for (const [key, cssValue] of Object.entries(getReadingAppearanceVariables(preferences))) target.style.setProperty(key, cssValue);
  target.style.colorScheme = preferences.theme === "dark" ? "dark" : "light";
  target.dataset.readingTheme = preferences.theme;
  return preferences;
}
export function getReadingAppearanceVariables(value: ReadingAppearancePreferences): ReadingAppearanceVariables {
  const preferences = normalizeReadingAppearance(value);
  const style = getReadingTextStyle(preferences);
  return { ...getReadingThemeVariables(preferences.theme),
    "--reading-font-family": String(style.fontFamily), "--reading-font-size": String(style.fontSize),
    "--reading-line-height": String(style.lineHeight), "--reading-letter-spacing": String(style.letterSpacing),
    "--reading-column-width": String(style.maxWidth), "--reading-text-align": String(style.textAlign),
  };
}
export function getReadingTextProps(value: ReadingAppearancePreferences): { lang: ReadingLanguage; style: CSSProperties } {
  return { lang: normalizeReadingAppearance(value).language, style: getReadingTextStyle(value) };
}
export function getReadingAppearanceLayoutKey(value: ReadingAppearancePreferences): string {
  const layout: Partial<ReadingAppearancePreferences> = { ...normalizeReadingAppearance(value) };
  delete layout.theme;
  // WHY：换色不影响分页；所有影响字形/换行的值必须触发重新测量，不能只依赖字号。
  return JSON.stringify(layout);
}

/**
 * 宿主在根布局 head 内用普通同步 script 注入，可传 CSP nonce；本模块不自行操作根节点。
 * html 加 suppressHydrationWarning（仅用于此脚本修改的属性）。配合组件 ready=false 防止表单先闪默认值。
 * 这里只预置主题；宿主须在正文首次显示/分页测量前 readReadingAppearance，统一装配排版属性。
 */
export function getReadingAppearanceBootstrapScript(): string {
  const config = JSON.stringify({ keys: READING_APPEARANCE_STORAGE_KEYS,
    themes: Object.fromEntries(READING_THEMES.map((theme) => [theme.id, getReadingThemeVariables(theme.id)])) });
  return "(()=>{const c=" + config.replace(/</g, "\\u003c") + ";" +
    "let theme='gray';try{const s=window.localStorage;let v=null;const raw=s.getItem(c.keys.preferences);" +
    "if(raw!==null){try{v=JSON.parse(raw)}catch(e){console.warn('[reading-appearance] 已保存设置损坏，将回退')}}" +
    "const valid=v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length>0&&(v.version===undefined||v.version===1);" +
    "const candidate=valid?(v.theme===undefined?s.getItem(c.keys.legacyTheme):v.theme):s.getItem(c.keys.legacyTheme);" +
    "if(typeof candidate==='string'&&Object.prototype.hasOwnProperty.call(c.themes,candidate))theme=candidate;" +
    "}catch(e){console.error('[reading-appearance] 无法读取主题偏好',e)}" +
    "const root=document.documentElement;for(const [key,value] of Object.entries(c.themes[theme]))root.style.setProperty(key,value);" +
    "root.style.colorScheme=c.themes[theme]['--reading-color-scheme'];root.dataset.readingTheme=theme;})();";
}
