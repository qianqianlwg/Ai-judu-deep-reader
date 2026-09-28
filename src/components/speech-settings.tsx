"use client";

import { useEffect, useId, useState } from "react";
import { DEFAULT_SPEECH_PREFERENCES, SPEECH_VOICES, speechPreferencesSchema, type SpeechPreferences } from "@/lib/speech";
import { SpeechPlaybackBar, useSpeech } from "./speech-controls";
import styles from "@/app/settings/settings.module.css";

function readPublicConfig(value: unknown): { preferences: SpeechPreferences; hasApiKey: boolean } {
  if (!value || typeof value !== "object") throw new Error("语音配置响应无效。");
  if ("error" in value && typeof value.error === "string") throw new Error(value.error);
  const { voice, playbackRate, volume, style, hasApiKey } = value as Record<string, unknown>;
  const parsed = speechPreferencesSchema.safeParse({ voice, playbackRate, volume, style });
  if (!parsed.success || typeof hasApiKey !== "boolean") throw new Error("语音配置响应无效。");
  return { preferences: parsed.data, hasApiKey };
}
export function SpeechSettings() {
  const [preferences, setPreferences] = useState<SpeechPreferences>(DEFAULT_SPEECH_PREFERENCES);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const speech = useSpeech(), previewSourceId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings/speech", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const config = readPublicConfig(await response.json() as unknown);
      if (!response.ok) throw new Error("读取语音配置失败。");
      if (!controller.signal.aborted) { setPreferences(config.preferences); setHasApiKey(config.hasApiKey); setReady(true); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { console.error("读取语音配置失败"); setError(cause instanceof Error ? cause.message : "读取语音配置失败，请刷新重试。"); }
    });
    return () => controller.abort();
  }, []);
  async function save(preview = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings/speech", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preferences, apiKey: apiKey || undefined }) });
      const config = readPublicConfig(await response.json() as unknown);
      if (!response.ok) throw new Error("保存语音配置失败。");
      setPreferences(config.preferences); setHasApiKey(config.hasApiKey); setApiKey(""); setNotice("语音配置已保存，新朗读会使用此配置。");
      if (preview) speech?.speak("你好，欢迎使用句读。让我们一起聆听文字，慢慢理解书中的思想。", "音色试听", previewSourceId);
    } catch (cause: unknown) { console.error("保存语音配置失败"); setError(cause instanceof Error ? cause.message : "保存失败，请检查服务后重试。"); }
    finally { setBusy(false); }
  }
  function change<K extends keyof SpeechPreferences>(key: K, value: SpeechPreferences[K]) { setPreferences(current => ({ ...current, [key]: value })); }
  return <section className={styles.card} aria-label="语音朗读设置" aria-busy={!ready || busy}>
    <h2>语音朗读 · MiMo</h2>
    <p className={styles.hint}>正文选句和 AI 句读共用此配置。模型固定为 mimo-v2.5-tts；仅在点击朗读后，将该文本发送至 MiMo 合成语音。</p>
    <fieldset disabled={!ready || busy} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="speech-settings-fields">
        <label>音色<select aria-label="朗读音色" value={preferences.voice} onChange={event => { const voice = SPEECH_VOICES.find(value => value === event.target.value); if (voice) change("voice", voice); }}>{SPEECH_VOICES.map(voice => <option key={voice} value={voice}>{voice === "mimo_default" ? "MiMo 默认" : voice}</option>)}</select></label>
        <label>播放语速<select aria-label="朗读语速" value={preferences.playbackRate} onChange={event => change("playbackRate", Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×{rate === 1 ? "（正常）" : ""}</option>)}</select></label>
        <label>音量<input type="range" aria-label="朗读音量" min={0} max={1} step={0.05} value={preferences.volume} onChange={event => change("volume", Number(event.target.value))}/><output>{Math.round(preferences.volume * 100)}%</output></label>
        <label>朗读风格<textarea aria-label="朗读风格" rows={3} maxLength={500} value={preferences.style} onChange={event => change("style", event.target.value)} placeholder="例如：温柔沉稳，普通话，语速稍慢，句尾适当停顿。"/></label>
        <label>MiMo API Key<input aria-label="MiMo API Key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={hasApiKey ? "已配置；留空保留现有密钥" : "输入 MiMo API Key"}/></label>
      </div>
      <p className={styles.hint}>密钥仅保存到服务端私有配置，不返回浏览器。播放语速和音量由播放器调整；语气、情绪和方言可在朗读风格中描述。默认流式播放，首批音频到达即开始朗读；长文自动分段并提前取流，可暂停、继续或停止。</p>
      <div className={styles.actions}><button type="button" onClick={() => setPreferences({ ...DEFAULT_SPEECH_PREFERENCES })}>恢复默认语音</button><button type="button" disabled={!speech || (!hasApiKey && !apiKey.trim())} onClick={() => { void save(true); }}>保存并试听</button><button type="button" onClick={() => { void save(); }}>{busy ? "保存中…" : "保存语音配置"}</button></div>
    </fieldset>
    <SpeechPlaybackBar/>
    {!ready && !error && <p role="status">正在读取语音配置…</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
