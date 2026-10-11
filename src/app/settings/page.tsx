"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CONTEXT_INPUT_TOKEN_OPTIONS, DEFAULT_CONTEXT_SETTINGS, normalizeContextInputTokens } from "@/lib/context-compaction";
import {
  DEFAULT_READING_APPEARANCE, READING_APPEARANCE_STORAGE_KEYS, applyReadingAppearanceToRoot, readReadingAppearance, writeReadingAppearance,
  type ReadingAppearancePreferences,
} from "@/lib/reading-appearance";
import { EmbeddingSettings } from "@/components/embedding-settings";
import { UiTypographySettings } from "@/components/ui-typography-settings";
import { SpeechSettings } from "@/components/speech-settings";
import { ReadingAppearanceSettings } from "@/components/reading-appearance-settings";
import { SettingsSidebar, type SettingsSectionId } from "./settings-sidebar";
import styles from "./settings.module.css";

type AiActionResponse = { error?: string; message?: string; maskedApiKey?: string };
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function readAiResponse(value: unknown): AiActionResponse {
  if (!isRecord(value)) return {};
  return {
    error: typeof value.error === "string" ? value.error : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    maskedApiKey: typeof value.maskedApiKey === "string" ? value.maskedApiKey : undefined,
  };
}

const SECTION_COPY: Record<SettingsSectionId, { title: string; description: string }> = {
  appearance: { title: "外观", description: "调整阅读空间的主题、重点配色和正文排版。" },
  reading: { title: "阅读", description: "调整界面字号；书页正文在外观中单独设置。" },
  speech: { title: "语音朗读", description: "设置朗读音色、播放速度与试听方式。" },
  ai: { title: "AI 句读", description: "连接模型服务，并管理默认模型。" },
  context: { title: "上下文", description: "为长篇阅读保留稳定的上下文预算和阅读记忆。" },
  search: { title: "语义搜索", description: "管理向量索引与按需语义检索。" },
};

function RailIcon({ name }: { name: "book" | "settings" }) {
  const path = name === "book"
    ? "M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H12v17h5.5A2.5 2.5 0 0 1 20 22V5.5Z"
    : "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z";
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

function SettingsBlock({ id, children }: { id: SettingsSectionId; children: ReactNode }) {
  const copy = SECTION_COPY[id];
  return <section id={`settings-section-${id}`} className={styles.settingsSection} data-settings-section={id} aria-labelledby={`settings-heading-${id}`}>
    <header className={styles.sectionHeader}><span className={styles.sectionKicker}>JUDU · SETTINGS</span><h2 id={`settings-heading-${id}`}>{copy.title}</h2><p>{copy.description}</p></header>
    {children}
  </section>;
}

export default function SettingsPage() {
  const [contextTokens, setContextTokens] = useState(String(DEFAULT_CONTEXT_SETTINGS.maxInputTokens));
  const [outputTokens, setOutputTokens] = useState("4096");
  const [compression, setCompression] = useState("balanced");
  const [appearance, setAppearance] = useState<ReadingAppearancePreferences>(DEFAULT_READING_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearanceError, setAppearanceError] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      if (!active) return;
      try {
        const result = readReadingAppearance(localStorage);
        setAppearance(result.preferences);
        setAppearanceReady(true);
        setAppearanceError(result.issues.join(" "));
        applyReadingAppearanceToRoot(document.documentElement, result.preferences);
        if (result.needsMigration && result.issues.length === 0) {
          try { writeReadingAppearance(localStorage, result.preferences); localStorage.removeItem(READING_APPEARANCE_STORAGE_KEYS.legacyTheme); localStorage.removeItem(READING_APPEARANCE_STORAGE_KEYS.legacyFontScale); }
          catch (error: unknown) {
            console.error("迁移阅读外观失败", { name: error instanceof Error ? error.name : "UnknownError" });
            setAppearanceError("旧阅读设置已读取，但暂时无法保存迁移结果；你仍可继续调整。");
          }
        }
      } catch (error: unknown) {
        console.error("读取阅读外观失败", { name: error instanceof Error ? error.name : "UnknownError" });
        setAppearanceReady(true);
        setAppearanceError("无法读取本地阅读外观，已使用默认设置；请检查浏览器存储权限。");
      }
      try {
        setContextTokens(String(normalizeContextInputTokens(localStorage.getItem("judu:maxInputTokens"))));
        setOutputTokens(localStorage.getItem("judu:maxOutputTokens") ?? "4096");
        setCompression(localStorage.getItem("judu:compressionStrategy") ?? "balanced");
      } catch (error: unknown) {
        console.error("读取阅读运行设置失败", { name: error instanceof Error ? error.name : "UnknownError" });
      }
    };
    // WHY：延后一帧读取 localStorage，避免服务端渲染直接触碰浏览器对象；根布局脚本负责主题首屏防闪。
    const frame = window.requestAnimationFrame(load);
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings/ai")
      .then((response) => response.json() as Promise<unknown>)
      .then((value) => { if (active && isRecord(value)) { const data = readAiResponse(value); setProvider(typeof value.provider === "string" ? value.provider : "openai"); setBaseUrl(typeof value.baseUrl === "string" ? value.baseUrl : ""); setModel(typeof value.model === "string" ? value.model : ""); setModels(Array.isArray(value.models) ? value.models.filter((item): item is string => typeof item === "string").join("\n") : typeof value.model === "string" ? value.model : ""); if (data.error) setAiNotice(data.error); } })
      .catch((error: unknown) => { console.error("读取 AI 配置失败", { name: error instanceof Error ? error.name : "UnknownError" }); if (active) setAiNotice("暂时无法读取 AI 配置。"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const id = visible?.target.getAttribute("data-settings-section");
      if (id && id in SECTION_COPY) setActiveSection(id as SettingsSectionId);
    }, { root, threshold: [0.15, 0.4, 0.7], rootMargin: "-8% 0px -62%" });
    root.querySelectorAll<HTMLElement>("[data-settings-section]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [appearanceReady]);

  const selectSection = (section: SettingsSectionId): void => {
    setActiveSection(section);
    const target = document.getElementById(`settings-section-${section}`);
    if (target) target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const saveAppearance = (value: ReadingAppearancePreferences): void => {
    try {
      const saved = writeReadingAppearance(localStorage, value);
      setAppearance(saved);
      setAppearanceError("");
      applyReadingAppearanceToRoot(document.documentElement, saved);
    } catch (error: unknown) {
      console.error("保存阅读外观失败", { name: error instanceof Error ? error.name : "UnknownError" });
      setAppearanceError("无法保存阅读外观，本次更改未应用；请检查浏览器存储权限后重试。");
    }
  };
  const saveContext = (value: string): void => { setContextTokens(value); localStorage.setItem("judu:maxInputTokens", value); };
  const saveOutput = (value: string): void => { setOutputTokens(value); localStorage.setItem("judu:maxOutputTokens", value); };
  const saveCompression = (value: string): void => { setCompression(value); localStorage.setItem("judu:compressionStrategy", value); };

  async function saveAi(): Promise<void> {
    setAiNotice("保存中…");
    try {
      const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, models: models.split(/[\n,，;；]+/u).map(value => value.trim()).filter(Boolean), apiKey: apiKey || undefined }) });
      const data = readAiResponse(await response.json() as unknown);
      setAiNotice(response.ok ? "已保存 " + (data.maskedApiKey ?? "") : data.error ?? "保存失败");
      if (response.ok) { setApiKey(""); window.dispatchEvent(new Event("judu:settings-updated")); localStorage.setItem("judu:ai-settings", String(Date.now())); }
    } catch (error: unknown) { console.error("保存 AI 配置失败", { name: error instanceof Error ? error.name : "UnknownError" }); setAiNotice("保存失败，请检查网络或服务状态。"); }
  }
  async function testAi(): Promise<void> {
    setAiNotice("测试中…");
    try {
      const response = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, apiKey: apiKey || undefined }) });
      const data = readAiResponse(await response.json() as unknown);
      setAiNotice(response.ok ? data.message ?? "连接成功" : data.error ?? "连接失败");
    } catch (error: unknown) { console.error("测试 AI 配置失败", { name: error instanceof Error ? error.name : "UnknownError" }); setAiNotice("连接失败，请检查网络或服务状态。"); }
  }

  const modelOptions = [...new Set(models.split(/[\n,，;；]+/u).map(value => value.trim()).filter(Boolean))];
  return <main className={styles.page} data-settings-page="true">
    <nav className={styles.rail} aria-label="应用导航">
      <Link href="/" className={styles.railButton} aria-label="返回阅读器" title="返回阅读器"><RailIcon name="book" /></Link>
      <span className={styles.railRule} aria-hidden="true" />
      <span className={styles.railButton + " " + styles.railButtonActive} aria-label="设置" title="设置"><RailIcon name="settings" /></span>
    </nav>
    <SettingsSidebar activeSection={activeSection} query={query} onQueryChange={setQuery} onSelect={selectSection} />
    <section id="main-content" tabIndex={-1} className={styles.main} ref={contentRef} aria-label="设置内容">
      <div className={styles.content}>
        <header className={styles.mainHeader}><span className={styles.kicker}>JUDU SETTINGS</span><h1>{SECTION_COPY[activeSection].title}</h1><p>{SECTION_COPY[activeSection].description}</p></header>
        <div className={styles.sectionStack}>
          <section id="settings-section-appearance" className={styles.settingsSection} data-settings-section="appearance" aria-labelledby="appearance-heading">
            <ReadingAppearanceSettings value={appearance} ready={appearanceReady} error={appearanceError} onChange={saveAppearance} />
          </section>
          <SettingsBlock id="reading"><UiTypographySettings /></SettingsBlock>
          <SettingsBlock id="speech"><SpeechSettings /></SettingsBlock>
          <SettingsBlock id="ai"><section className={styles.card}><h2>AI 句读</h2><label>协议<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="openai">OpenAI</option><option value="claude">Claude</option></select></label><label>API URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><label>模型列表<textarea aria-label="模型列表" rows={4} value={models} onChange={event => { setModels(event.target.value); const first = event.target.value.split(/[\n,，;；]+/u).map(value => value.trim()).filter(Boolean); if (!first.includes(model)) setModel(first[0] ?? ""); }} placeholder="每行一个模型名称，也可用逗号分隔" /></label><label>默认模型<select aria-label="默认模型" value={model} onChange={event => setModel(event.target.value)}>{modelOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label><p className={styles.hint}>多个模型共用此 API 地址、协议和密钥；聊天框可以逐次选择，默认模型用于未指定模型的请求。</p><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则保留已保存 Key" /></label><div className={styles.actions}><button type="button" onClick={() => void testAi()}>测试连接</button><button type="button" onClick={() => void saveAi()}>保存</button></div>{aiNotice && <p className={styles.hint} role="status">{aiNotice}</p>}</section></SettingsBlock>
          <SettingsBlock id="context"><section className={styles.card}><h2>上下文</h2><label>最大输入 Token<select aria-label="最大输入 Token" value={contextTokens} onChange={(event) => saveContext(event.target.value)}>{CONTEXT_INPUT_TOKEN_OPTIONS.map((value) => <option key={value} value={value}>{value === 1000000 ? "1M" : value / 1000 + "K"}</option>)}</select></label><label>最大输出 Token<select aria-label="最大输出 Token" value={outputTokens} onChange={(event) => saveOutput(event.target.value)}><option value="1024">1K</option><option value="2048">2K</option><option value="4096">4K</option><option value="8192">8K</option><option value="16384">16K</option></select></label><label>压缩触发<select value={compression} onChange={(event) => saveCompression(event.target.value)}><option value="conservative">保守</option><option value="balanced">平衡</option><option value="aggressive">激进</option></select></label><p className={styles.hint}>解读方式与回复长度在回复框的加号菜单设置，按书保存，下次回复生效。</p><p className={styles.hint}>接近预算时将已有对话整理成阅读记忆，保留关键约定、概念和未解问题；不按最近条数截取。新消息追加在检查点之后。调整预算后，可在原消息上重试；选文和原问题不会改变。</p></section></SettingsBlock>
          <SettingsBlock id="search"><EmbeddingSettings /></SettingsBlock>
        </div>
      </div>
    </section>
  </main>;
}
