"use client";

import { useId, type CSSProperties } from "react";
import {
  DEFAULT_READING_APPEARANCE, READING_APPEARANCE_LIMITS, READING_COLUMN_WIDTHS, READING_FONTS,
  READING_THEMES, getReadingAppearanceVariables, getReadingTextProps, getReadingThemeVariables,
  normalizeReadingAppearance, type ReadingAppearancePreferences, type ReadingTheme,
} from "@/lib/reading-appearance";
import styles from "./reading-appearance-settings.module.css";

export interface ReadingAppearanceSettingsProps {
  value: ReadingAppearancePreferences;
  onChange: (value: ReadingAppearancePreferences) => void;
  /** 宿主完成本地偏好读取前传 false，SSR 与首次水合均显示占位而不是错误主题。 */
  ready?: boolean;
  disabled?: boolean;
  /** 宿主捕获存储异常/读取 issues 后在这里反馈；组件本身不读写存储或发送请求。 */
  error?: string;
  className?: string;
}
const PREVIEW_TEXT = {
  "zh-CN": { title: "让阅读，回到文字本身", text: "书页之间，不必急于抵达结论。停在一段文字前，听清它的语气，再循着自己的问题慢慢读下去。\n\n留一点空白，也给思想留一点余地。" },
  en: { title: "Room to read, space to think", text: "There is no need to hurry toward a conclusion. Stay with a passage, listen to its voice, and follow the questions it brings to mind.\n\nA little space on the page can leave more room for thought." },
};
function ThemeThumbnail({ theme }: { theme: ReadingTheme }) {
  return <span className={styles.thumbnail} data-testid="reading-appearance-theme" style={getReadingThemeVariables(theme.id) as CSSProperties} aria-hidden="true">
    <span className={styles.miniSidebar}><i /><i /><i /><i /></span>
    <span className={styles.miniPaper}><b>Aa</b><i /><i /><i /><i /></span>
    <span className={styles.miniAssistant}><i /><i /><i /></span>
  </span>;
}
function Preview({ value }: { value: ReadingAppearancePreferences }) {
  const copy = PREVIEW_TEXT[value.language];
  const textProps = getReadingTextProps(value);
  // WHY：设置卡不可能容纳 780px 真书页；栏宽等比缩略，字号/行距/字距保持真实 CSS 值。
  const width = value.columnWidth === "auto" ? "100%" : (value.columnWidth / 780 * 100) + "%";
  return <figure className={styles.preview} style={getReadingAppearanceVariables(value) as CSSProperties}>
    <figcaption className={styles.previewCaption}><span>阅读预览</span><span>{value.fontSize}px · {value.lineHeight.toFixed(1)} 倍行距</span></figcaption>
    <div className={styles.previewWorkspace}>
      <div className={styles.previewSidebar} aria-hidden="true"><i /><i /><i /></div>
      <div className={styles.previewPaper}>
        <article {...textProps} className={styles.previewText} style={{ ...textProps.style, width }} data-testid="reading-appearance-preview">
          <h3>{copy.title}</h3><p>{copy.text}</p>
        </article>
      </div>
      <div className={styles.previewAssistant} aria-hidden="true"><i /><i /><i /></div>
    </div>
    <p className={styles.previewNote}>栏宽等比缩略，字体与间距即时预览。主题色仅供外观选择，不代表护眼功效。</p>
  </figure>;
}
interface RangeSettingProps {
  id: string;
  label: string;
  name: "fontSize" | "lineHeight" | "letterSpacing";
  value: number;
  unit: string;
  onChange: (value: number) => void;
}
function RangeSetting({ id, label, name, value, unit, onChange }: RangeSettingProps) {
  const limits = READING_APPEARANCE_LIMITS[name];
  const display = name === "fontSize" ? String(value) : name === "lineHeight" ? value.toFixed(1) : value.toFixed(2);
  return <div className={styles.rangeField}>
    <label htmlFor={id}>{label}</label><output htmlFor={id}>{display}{unit}</output>
    <input id={id} name={name} type="range" {...limits} value={value} aria-valuetext={display + unit}
      onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    <span className={styles.rangeBounds} aria-hidden="true"><span>{limits.min}{unit}</span><span>{limits.max}{unit}</span></span>
  </div>;
}
export function ReadingAppearanceSettings({ value, onChange, ready = true, disabled = false, error, className = "" }: ReadingAppearanceSettingsProps) {
  const id = useId();
  const preferences = normalizeReadingAppearance(value);
  const blocked = disabled || !ready;
  const update = (patch: Partial<ReadingAppearancePreferences>) => {
    if (!blocked) onChange(normalizeReadingAppearance({ ...preferences, ...patch }));
  };
  return <section className={styles.root + " " + className} aria-labelledby={id + "-heading"} aria-busy={!ready}
    style={ready ? getReadingAppearanceVariables(preferences) as CSSProperties : undefined}>
    <header className={styles.header}>
      <span className={styles.monogram} aria-hidden="true">Aa</span>
      <div><h2 id={id + "-heading"}>阅读外观</h2><p>把书页调整成你喜欢的样子</p></div>
      <button className={styles.reset} type="button" disabled={blocked}
        onClick={() => update(DEFAULT_READING_APPEARANCE)} aria-label="恢复默认阅读外观">恢复默认</button>
    </header>
    {!ready && <p className={styles.loading} role="status">正在读取阅读外观…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.content} data-ready={ready} data-testid="reading-appearance-content">
      <fieldset className={styles.themeField} disabled={blocked}>
        <legend>主题</legend>
        <div className={styles.themes}>
          {READING_THEMES.map((theme) => <label className={styles.themeOption} key={theme.id}>
            <input type="radio" name={id + "-theme"} value={theme.id} checked={preferences.theme === theme.id}
              aria-label={theme.label} aria-describedby={id + "-theme-" + theme.id}
              onChange={() => update({ theme: theme.id })} />
            <span className={styles.themeCard}>
              <ThemeThumbnail theme={theme} />
              <span className={styles.themeName}>{theme.label}<span className={styles.check} aria-hidden="true">✓</span></span>
              <small id={id + "-theme-" + theme.id}>{theme.description}</small>
            </span>
          </label>)}
        </div>
      </fieldset>
      <div className={styles.layout}>
        <fieldset className={styles.controls} disabled={blocked}>
          <legend>文字与版式</legend>
          <label className={styles.selectField} htmlFor={id + "-font"}><span>字体</span>
            <select id={id + "-font"} name="font" value={preferences.font}
              onChange={(event) => update({ font: READING_FONTS.find((font) => font.id === event.currentTarget.value)!.id })}>
              {READING_FONTS.map((font) => <option key={font.id} value={font.id} style={{ fontFamily: font.family }}>{font.label}</option>)}
            </select>
          </label>
          <p className={styles.hint}>使用设备已安装字体；缺失时按同类字体回退，不下载字体。</p>
          <RangeSetting id={id + "-size"} name="fontSize" label="字号" value={preferences.fontSize} unit="px" onChange={(fontSize) => update({ fontSize })} />
          <RangeSetting id={id + "-height"} name="lineHeight" label="行距" value={preferences.lineHeight} unit=" 倍" onChange={(lineHeight) => update({ lineHeight })} />
          <RangeSetting id={id + "-spacing"} name="letterSpacing" label="字距" value={preferences.letterSpacing} unit="em" onChange={(letterSpacing) => update({ letterSpacing })} />
          <label className={styles.selectField} htmlFor={id + "-width"}><span>列宽</span>
            <select id={id + "-width"} name="columnWidth" value={preferences.columnWidth}
              onChange={(event) => update({ columnWidth: READING_COLUMN_WIDTHS.find((width) => String(width) === event.currentTarget.value)! })}>
              {READING_COLUMN_WIDTHS.map((width) => <option key={width} value={width}>{width === "auto" ? "自适应" : width + "px"}</option>)}
            </select>
          </label>
          <fieldset className={styles.alignment}><legend>对齐</legend><div>
            {([{ value: "left", label: "左对齐" }, { value: "justify", label: "两端对齐" }] as const).map((option) => <label key={option.value}>
              <input type="radio" name={id + "-alignment"} value={option.value} checked={preferences.textAlign === option.value}
                onChange={() => update({ textAlign: option.value })} /><span>{option.label}</span>
            </label>)}
          </div></fieldset>
          <label className={styles.selectField} htmlFor={id + "-language"}><span>阅读语言</span>
            <select id={id + "-language"} name="language" value={preferences.language} aria-describedby={id + "-language-hint"}
              onChange={(event) => update({ language: event.currentTarget.value === "en" ? "en" : "zh-CN" })}>
              <option value="zh-CN">中文</option><option value="en">English</option>
            </select>
          </label>
          <p id={id + "-language-hint"} className={styles.hint}>只设置阅读区域的语言及预览，不翻译原书或更改全站界面语言。</p>
        </fieldset>
        <Preview value={preferences} />
      </div>
    </div>
  </section>;
}
