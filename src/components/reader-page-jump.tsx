"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./reader-page-jump.module.css";

type Props = { current: number; total: number; disabled?: boolean; chapter?: boolean; onJump(page: number): void };
export function ReaderPageJump({ current, total, disabled = false, chapter = false, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: 0, bottom: 48 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const unavailable = disabled || total < 1;
  const label = chapter ? "本章页码" : "页码";
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    input.current?.focus(); input.current?.select();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [open]);
  return <div className={styles.jump}>
    <button ref={trigger} type="button" className={styles.trigger} disabled={unavailable} aria-label="选择页码跳转" aria-expanded={open && !unavailable}
      title={chapter ? "点击跳转本章屏幕页 · 页数随字体和窗口变化" : "点击页码跳转"} onClick={() => {
        if (open) { close(); return; }
        const rect = trigger.current!.getBoundingClientRect();
        setPosition({ left: Math.max(12, Math.min(rect.left + rect.width / 2 - 120, window.innerWidth - 252)), bottom: Math.max(12, window.innerHeight - rect.top + 10) });
        setDraft(String(current)); setError(""); setOpen(true);
      }}>
      {chapter&&<span className={styles.scope}>本章</span>}<span className={styles.current}>{current}</span><span className={styles.total}> / {total}</span>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m3 7 3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {/* WHY：底栏位于阅读器的 overflow 容器内，跳转浮层通过 Portal 显示，避免遮挡正文布局或被底栏裁切。 */}
    {open && !unavailable && createPortal(<form ref={panel} className={styles.panel} style={position} aria-label="页码跳转"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onSubmit={event => {
        event.preventDefault();
        const page = Number(draft);
        if (!/^\d+$/u.test(draft) || !Number.isSafeInteger(page) || page < 1 || page > total) {
          setError(`请输入 1 到 ${total} 之间的整数页码`); return;
        }
        onJump(page); close();
      }}>
      <header><strong>跳转到指定页</strong><button type="button" aria-label="关闭页码跳转" onClick={close}>×</button></header>
      <div className={styles.fields}><input ref={input} aria-label={label} type="text" inputMode="numeric" value={draft} aria-invalid={Boolean(error)}
        onChange={event => { setDraft(event.target.value); setError(""); }} /><span>/ {total}</span><button type="submit">跳转</button></div>
      {error ? <p className={styles.error} role="alert">{error}</p> : <p>{chapter ? "本章屏幕页，随字体和窗口重新排版" : "输入页码，按 Enter 确认"}</p>}
    </form>, document.body)}
  </div>;
}
