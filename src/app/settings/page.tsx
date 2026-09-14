"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [fontSize, setFontSize] = useState("1");
  const [theme, setTheme] = useState("light");
  const [contextTokens, setContextTokens] = useState("32768");

  const [compression, setCompression] = useState("balanced");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  useEffect(() => { window.requestAnimationFrame(() => { setFontSize(localStorage.getItem("judu:fontScale") ?? "1"); setTheme(localStorage.getItem("judu:theme") ?? "light"); setContextTokens(localStorage.getItem("judu:maxInputTokens") ?? "32768"); setCompression(localStorage.getItem("judu:compressionStrategy") ?? "balanced"); }); }, []);
  const saveFont = (value: string) => { setFontSize(value); localStorage.setItem("judu:fontScale", value); };
  const saveTheme = (value: string) => { setTheme(value); localStorage.setItem("judu:theme", value); };
  const saveContext = (value: string) => { setContextTokens(value); localStorage.setItem("judu:maxInputTokens", value); };
  const saveCompression = (value: string) => { setCompression(value); localStorage.setItem("judu:compressionStrategy", value); };
  useEffect(() => { void fetch("/api/settings/ai").then((response) => response.json()).then((data: { provider?: string; baseUrl?: string; model?: string }) => { setProvider(data.provider ?? "openai"); setBaseUrl(data.baseUrl ?? ""); setModel(data.model ?? ""); }).catch((error: unknown) => console.error("读取 AI 配置失败", error)); }, []);
  async function saveAi(): Promise<void> { setAiNotice("保存中…"); const response = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, apiKey: apiKey || undefined }) }); const data = await response.json() as { error?: string; maskedApiKey?: string }; setAiNotice(response.ok ? `已保存 ${data.maskedApiKey ?? ""}` : data.error ?? "保存失败"); if (response.ok) setApiKey(""); }
  async function testAi(): Promise<void> { setAiNotice("测试中…"); const response = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, baseUrl, model, apiKey: apiKey || undefined }) }); const data = await response.json() as { error?: string; message?: string }; setAiNotice(response.ok ? data.message ?? "连接成功" : data.error ?? "连接失败"); }
  return <main className="settings-page"><header className="settings-header"><Link href="/" className="back-link">← 返回阅读器</Link><div><span className="panel-kicker">JUDU SETTINGS</span><h1>设置</h1></div></header>
    <section className="settings-card"><h2>阅读体验</h2><label>正文大小<select value={fontSize} onChange={event => saveFont(event.target.value)}><option value="0.85">小</option><option value="1">中</option><option value="1.15">大</option></select></label><label>主题<select value={theme} onChange={event => saveTheme(event.target.value)}><option value="light">浅色</option><option value="paper">纸张</option><option value="dark">深色</option></select></label><p className="settings-hint">设置会保存在当前浏览器，返回阅读器后生效。</p></section>
    <section className="settings-card"><h2>上下文</h2><label>最大上下文<select value={contextTokens} onChange={event => saveContext(event.target.value)}><option value="8192">8K</option><option value="16384">16K</option><option value="32768">32K</option><option value="65536">64K</option></select></label><label>压缩策略<select value={compression} onChange={event => saveCompression(event.target.value)}><option value="conservative">保守</option><option value="balanced">平衡</option><option value="aggressive">激进</option></select></label><p className="settings-hint">接近上限时压缩较早对话，保留最近消息和当前原文证据。</p></section>
    <section className="settings-card"><h2>AI 句读</h2><label>协议<select value={provider} onChange={event => setProvider(event.target.value)}><option value="openai">OpenAI</option><option value="claude">Claude</option></select></label><label>API URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label><label>模型<input value={model} onChange={event => setModel(event.target.value)} placeholder="模型名称" /></label><label>API Key<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="留空则保留已保存 Key" /></label><div className="settings-actions"><button onClick={() => void testAi()}>测试连接</button><button onClick={() => void saveAi()}>保存</button></div>{aiNotice && <p className="settings-hint">{aiNotice}</p>}</section></main>;
}
