"use client";
import { useEffect, useState } from "react";
import { applyUiTextSize, DEFAULT_UI_TEXT_SIZE, normalizeUiTextSize, UI_TEXT_SIZE_KEY, UI_TEXT_SIZE_MAX, UI_TEXT_SIZE_MIN } from "@/lib/ui-typography";
import styles from "@/app/settings/settings.module.css";

export function UiTypographySettings() {
  const [size, setSize] = useState(DEFAULT_UI_TEXT_SIZE);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    // WHY：挂载后异步读取浏览器偏好，避免服务端差异与 effect 内同步更新造成的级联渲染。
    void Promise.resolve().then(() => {
    if (!active) return;
    try { const current = normalizeUiTextSize(localStorage.getItem(UI_TEXT_SIZE_KEY)); setSize(current); applyUiTextSize(document.documentElement, current); }
    catch (cause: unknown) { console.error("读取界面字号失败", cause); setError("无法读取界面字号，已使用默认值；请检查浏览器存储。"); }
    });
    return () => { active = false; };
  }, []);
  function change(value: number) {
    const normalized = applyUiTextSize(document.documentElement, value);
    setSize(normalized); setError("");
    try { localStorage.setItem(UI_TEXT_SIZE_KEY, String(normalized)); }
    catch (cause: unknown) { console.error("保存界面字号失败", cause); setError("字号已应用，但未能保存；下次打开可能恢复默认值。"); }
  }
  return <section className={styles.card} aria-label="界面字号设置"><h2>界面与 AI 回答</h2>
    <label>非正文字号 <input type="range" aria-label="非正文字号" min={UI_TEXT_SIZE_MIN} max={UI_TEXT_SIZE_MAX} step={1} value={size} onChange={event => change(Number(event.target.value))}/><output aria-live="polite">{size} px</output></label>
    <p className={styles.hint}>调整导航、操作界面、书架、知识库及 AI 回答的文字；不改变书页正文的字体大小或分页。正文仍在「阅读外观」中单独设置。</p>
    <div className={styles.actions}><button type="button" onClick={() => change(DEFAULT_UI_TEXT_SIZE)}>恢复默认界面字号</button></div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
