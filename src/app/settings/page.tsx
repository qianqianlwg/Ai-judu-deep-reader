"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTEXT_INPUT_TOKEN_OPTIONS, DEFAULT_CONTEXT_SETTINGS, normalizeContextInputTokens } from "@/lib/context-compaction";
import { normalizeReadingDetail } from "@/lib/reading-detail";
import {
  DEFAULT_READING_APPEARANCE, READING_APPEARANCE_STORAGE_KEYS, applyReadingAppearanceToRoot, readReadingAppearance, writeReadingAppearance,
  type ReadingAppearancePreferences,
} from "@/lib/reading-appearance";
import { ReadingAppearanceSettings } from "@/components/reading-appearance-settings";
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

export default function SettingsPage() {
  const [contextTokens, setContextTokens] = useState(String(DEFAULT_CONTEXT_SETTINGS.maxInputTokens));
  const [outputTokens, setOutputTokens] = useState("4096");
  const [compression, setCompression] = useState("balanced");
  const [readingDetail, setReadingDetail] = useState("standard");
  const [appearance, setAppearance] = useState<ReadingAppearancePreferences>(DEFAULT_READING_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [appearanceError, setAppearanceError] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiNotice, setAiNotice] = useState("");

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
        setReadingDetail(normalizeReadingDetail(localStorage.getItem("judu:readingDetail")));
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
      .then((value) => { if (active && isRecord(value)) { const data = readAiResponse(value); setProvider(typeof value.provider === "string" ? value.provider : "openai"); setBaseUrl(typeof value.baseUrl === "string" ? value.baseUrl : ""); setModel(typeof value.model === "string" ? value.model : ""); if (data.error) setAiNotice(data.error); } })
      .catch((error: unknown) => { console.error("读取 AI 配置失败", { name: error instanceof Error ? error.name : "UnknownError" }); if (active) setAiNotice("暂时无法读取 AI 配置。"); });
    return () => { active = false; };
  }, []);

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
  const saveReadingDetail = (value: string): void => { const normalized = normalizeReadingDetail(value); setReadingDetail(normalized); localStorage.setItem("judu:readingDetail", normalized); };

  async function saveAi(): Promise<void> {
    setAiNotice("保存中…");
    try {
      const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, apiKey: apiKey || undefined }) });
      const data = readAiResponse(await response.json() as unknown);
      setAiNotice(response.ok ? "已保存 " + (data.maskedApiKey ?? "") : data.error ?? "保存失败");
      if (response.ok) setApiKey("");
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

  return <main className={styles.page} data-settings-page="true"><div className={styles.content}>
    <header className={styles.header}><Link href="/" className={styles.backLink}>← 返回阅读器</Link><div><span className={styles.kicker}>JUDU SETTINGS</span><h1>设置</h1></div></header>
    <ReadingAppearanceSettings value={appearance} ready={appearanceReady} error={appearanceError} onChange={saveAppearance} />
    <section className={styles.card}><h2>上下文</h2><label>最大输入 Token<select aria-label="最大输入 Token" value={contextTokens} onChange={(event) => saveContext(event.target.value)}>{CONTEXT_INPUT_TOKEN_OPTIONS.map((value) => <option key={value} value={value}>{value === 1000000 ? "1M" : value / 1000 + "K"}</option>)}</select></label><label>最大输出 Token<select aria-label="最大输出 Token" value={outputTokens} onChange={(event) => saveOutput(event.target.value)}><option value="1024">1K</option><option value="2048">2K</option><option value="4096">4K</option><option value="8192">8K</option><option value="16384">16K</option></select></label><label>压缩触发<select value={compression} onChange={(event) => saveCompression(event.target.value)}><option value="conservative">保守</option><option value="balanced">平衡</option><option value="aggressive">激进</option></select></label><label>句读详细程度<select aria-label="句读详细程度" value={readingDetail} onChange={(event) => saveReadingDetail(event.target.value)}><option value="concise">精简（约 1:1.2）</option><option value="standard">标准（约 1:1.5）</option><option value="detailed">详细（约 1:2）</option></select></label><p className={styles.hint}>接近预算时将已有对话整理成阅读记忆，保留关键约定、概念和未解问题；不按最近条数截取。新消息追加在检查点之后。调整预算后，可在原消息上重试；选文和原问题不会改变。</p></section>
    <section className={styles.card}><h2>AI 句读</h2><label>协议<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="openai">OpenAI</option><option value="claude">Claude</option></select></label><label>API URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><label>模型<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型名称" /></label><label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="留空则保留已保存 Key" /></label><div className={styles.actions}><button type="button" onClick={() => void testAi()}>测试连接</button><button type="button" onClick={() => void saveAi()}>保存</button></div>{aiNotice && <p className={styles.hint} role="status">{aiNotice}</p>}</section>
  </div></main>;
}
