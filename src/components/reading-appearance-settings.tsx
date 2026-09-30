"use client";

import { useId, type CSSProperties } from "react";
import { ReadingEnhancementControl } from "./reading-enhancement-control";
import { ANSWER_EMPHASIS_PALETTES } from "@/lib/answer-emphasis-palette";
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
  "zh-CN": {
    title: "\u8ba9\u9605\u8bfb\uff0c\u56de\u5230\u6587\u5b57\u672c\u8eab",
    paragraphs: ["\u4e66\u9875\u4e4b\u95f4\uff0c\u4e0d\u5fc5\u6025\u4e8e\u62b5\u8fbe\u7ed3\u8bba\u3002\u505c\u5728\u4e00\u6bb5\u6587\u5b57\u524d\uff0c\u542c\u6e05\u5b83\u7684\u8bed\u6c14\uff0c\u518d\u5faa\u7740\u81ea\u5df1\u7684\u95ee\u9898\u6162\u6162\u8bfb\u4e0b\u53bb\u3002", "\u7559\u4e00\u70b9\u7a7a\u767d\uff0c\u4e5f\u7ed9\u601d\u60f3\u7559\u4e00\u70b9\u4f59\u5730\u3002"],
    term: "\u4e00\u6bb5\u6587\u5b57",
    sentence: "\u5faa\u7740\u81ea\u5df1\u7684\u95ee\u9898\u6162\u6162\u8bfb\u4e0b\u53bb\u3002",
  },
  en: {
    title: "Room to read, space to think",
    paragraphs: ["There is no need to hurry toward a conclusion. Stay with a passage, listen to its voice, and follow the questions it brings to mind.", "A little space on the page can leave more room for thought."],
    term: "a passage",
    sentence: "follow the questions it brings to mind.",
  },
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
  const font = READING_FONTS.find((item) => item.id === value.font);
  // WHY：Keep the preview proportional to the real reading width so column changes remain visible without making the settings card overflow.
  const width = value.columnWidth === "auto" ? "100%" : (value.columnWidth / 780 * 100) + "%";
  const widthLabel = value.columnWidth === "auto" ? "\u81ea\u9002\u5e94" : `${value.columnWidth}px`;
  const alignmentLabel = value.textAlign === "justify" ? "\u4e24\u7aef\u5bf9\u9f50" : "\u5de6\u5bf9\u9f50";
  const highlightTerm = value.semanticTerms || value.sourceTerms;
  const underlineSentence = value.semanticSentences || value.sourceSentences;
  const renderParagraph = (paragraph: string, index: number) => {
    if (index !== 0) return paragraph;
    const termIndex = paragraph.indexOf(copy.term);
    const sentenceIndex = paragraph.indexOf(copy.sentence);
    if (termIndex < 0 || sentenceIndex < termIndex + copy.term.length) return paragraph;
    return <>{paragraph.slice(0, termIndex)}{highlightTerm ? <mark className={styles.previewTerm}>{copy.term}</mark> : copy.term}{paragraph.slice(termIndex + copy.term.length, sentenceIndex)}{underlineSentence ? <span className={styles.previewSentence}>{copy.sentence}</span> : copy.sentence}{paragraph.slice(sentenceIndex + copy.sentence.length)}</>;
  };
  return <figure className={styles.preview} style={getReadingAppearanceVariables(value) as CSSProperties} data-testid="reading-appearance-preview-shell">
    <figcaption className={styles.previewCaption}>
      <span><strong>{"\u9605\u8bfb\u9884\u89c8"}</strong><small>{"\u4fee\u6539\u9009\u9879\u540e\u5373\u65f6\u66f4\u65b0"}</small></span>
      <span className={styles.previewMetrics}><b>{value.fontSize}px</b><b>{value.lineHeight.toFixed(1)} {"\u500d\u884c\u8ddd"}</b><b>{widthLabel}</b></span>
    </figcaption>
    <div className={styles.previewToolbar} aria-hidden="true"><span className={styles.previewToolbarDots}><i /><i /><i /></span><span>{"\u53e5\u8bfb \u00b7 \u5f53\u524d\u4e66\u9875"}</span><span className={styles.previewToolbarChip}>{alignmentLabel}</span></div>
    <div className={styles.previewWorkspace}>
      <div className={styles.previewSidebar} aria-hidden="true"><i className={styles.previewSidebarActive} /><i /><i /><i /></div>
      <div className={styles.previewPaper}>
        <article {...textProps} className={styles.previewText} style={{ ...textProps.style, width }} data-testid="reading-appearance-preview">
          <h3>{copy.title}</h3>
          {copy.paragraphs.map((paragraph, index) => <p key={paragraph}>{renderParagraph(paragraph, index)}</p>)}
        </article>
      </div>
      <aside className={styles.previewAssistant} aria-label={"\u56de\u7b54\u9884\u89c8"}><span className={styles.previewAssistantBadge}>AI</span><p /><p /><p className={styles.previewAssistantShort} /></aside>
    </div>
    <div className={styles.previewLegend}><span><i className={styles.previewLegendTerm} />{"\u91cd\u70b9\u8bcd"}</span><span><i className={styles.previewLegendSentence} />{"\u5173\u952e\u53e5"}</span><span className={styles.previewFontLabel}>{font?.label ?? "\u7cfb\u7edf"}</span></div>
    <p className={styles.previewNote}>{"\u680f\u5bbd\u3001\u5bf9\u9f50\u3001\u5b57\u4f53\u3001\u5b57\u8ddd\u3001\u884c\u8ddd\u548c\u91cd\u70b9\u663e\u793a\u5747\u4e3a\u7f29\u7565\u9884\u89c8\uff1b\u4e3b\u9898\u8272\u4ec5\u4f9b\u5916\u89c2\u9009\u62e9\uff0c\u4e0d\u4ee3\u8868\u62a4\u773c\u529f\u6548\u3002"}</p>
  </figure>;
}
interface RangeSettingProps {
  id: string;
  label: string;
  name: "fontSize" | "lineHeight" | "letterSpacing" | "analysisHintOpacity";
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
      <fieldset className={styles.paletteField} disabled={blocked}>
        <legend>句读重点配色</legend>
        <p className={styles.paletteHint}>用于右侧回答、细分句读和已开启的原文增强；不改变手动标注与书页主题。</p>
        <div className={styles.palettes}>
          {ANSWER_EMPHASIS_PALETTES.map((palette) => <label className={styles.paletteOption} key={palette.id}
            style={getReadingThemeVariables(preferences.theme, palette.id) as CSSProperties}>
            <input type="radio" name={id + "-emphasis-palette"} value={palette.id}
              checked={preferences.emphasisPalette === palette.id} aria-label={palette.label}
              onChange={() => update({ emphasisPalette: palette.id })} />
            <span className={styles.paletteCard}>
              <span className={styles.paletteHeading}>{palette.label}<span aria-hidden="true">{preferences.emphasisPalette === palette.id ? "✓" : ""}</span></span>
              <small>{palette.description}</small>
              <span className={styles.paletteSample} aria-hidden="true">先理解<span className={styles.paletteTerm}>关键词</span>，再读懂<span className={styles.paletteSentence}>这一句的意思。</span></span>
            </span>
          </label>)}
        </div>
      </fieldset>
      <ReadingEnhancementControl value={preferences} onChange={update} disabled={blocked}/>
      <div className={styles.layout}>
        <fieldset className={styles.controls} disabled={blocked}>
          <legend>文字与版式</legend>
          <label className={styles.selectField} htmlFor={id + "-font"}><span>字体</span>
            <select id={id + "-font"} name="font" value={preferences.font}
              onChange={(event) => update({ font: READING_FONTS.find((font) => font.id === event.currentTarget.value)!.id })}>
              {READING_FONTS.map((font) => <option key={font.id} value={font.id} style={{ fontFamily: font.family }}>{font.label}</option>)}
            </select>
          </label>
          <p className={styles.hint}>霞鹜文楷为本地托管字体，仅选中时加载；其他字体优先使用设备字体，缺失时回退。</p>
          <label className={styles.checkboxField}><input type="checkbox" name="originalBodyFontOverride" checked={preferences.originalBodyFontOverride} onChange={(event) => update({ originalBodyFontOverride: event.currentTarget.checked })} /> 原版正文统一使用阅读字体</label>
          <p className={styles.hint}>默认保留书内排版；开启后只覆盖原版正文及内联文字的字体，不改变字号、对齐、缩进或标题。</p>
          <label className={styles.checkboxField}><input type="checkbox" name="showAnalysisHints" disabled={blocked} checked={preferences.showAnalysisHints} onChange={(event) => update({ showAnalysisHints: event.currentTarget.checked })} /> 显示句读线</label>
          <RangeSetting id={id + "-analysis-opacity"} name="analysisHintOpacity" label="句读线透明度" value={preferences.analysisHintOpacity} unit="" onChange={(analysisHintOpacity) => update({ analysisHintOpacity })} />
          <p className={styles.hint}>使用半透明细线标识已句读文字；概念已有黄色高亮，不重复画线。</p>
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
