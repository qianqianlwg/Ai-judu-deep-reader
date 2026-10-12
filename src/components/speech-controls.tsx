"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { IDLE_SPEECH_STATE, SpeechPlayer, type SpeechState } from "@/lib/speech-player";
import { PcmSpeechOutput } from "@/lib/speech-pcm";
import "./speech-controls.css";

type SpeechContextValue = {
  state: SpeechState;
  speak: (text: string, label: string, sourceId?: string) => void;
  stop: (sourceId?: string) => void;
  pause: () => void;
  resume: () => void;
};
const SpeechContext = createContext<SpeechContextValue | null>(null);
export function useSpeech() { return useContext(SpeechContext); }
export function SpeechProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SpeechState>(IDLE_SPEECH_STATE);
  const [player] = useState(() => new SpeechPlayer({ fetcher: (...args) => fetch(...args), createOutput: signal => new PcmSpeechOutput(new AudioContext(), signal), onChange: setState }));
  const actions = useMemo(() => ({
    speak: (text: string, label: string, sourceId?: string) => { void player.speak(text, label, sourceId); },
    stop: (sourceId?: string) => player.stop(sourceId),
    pause: () => player.pause(),
    resume: () => { void player.resume(); },
  }), [player]);
  useEffect(() => () => player.stop(), [player]);
  // WHY：这里只装配共享播放器，不渲染全局浮窗；阅读页通过固定预留槽承载控制栏，不因播放状态改变正文尺寸。
  return <SpeechContext.Provider value={{ state, ...actions }}>{children}</SpeechContext.Provider>;
}
export function SpeechPlaybackBar({reserveSpace=false, inline=false}:{reserveSpace?:boolean; inline?:boolean}={}) {
  const speech = useSpeech();
  if (!speech) return null;
  // WHY：预留槽从空闲到播放保持同一尺寸，防止控制栏挂载、停止或报错触发 EPUB 重新分页和位置位移。
  if (speech.state.phase === "idle") return reserveSpace || inline ? <section className={inline ? "speech-footer speech-footer-inline" : "speech-footer"} data-reserve-space={reserveSpace || undefined} data-inline={inline || undefined} data-phase="idle" aria-hidden="true" data-reader-decoration=""/> : null;
  const { state } = speech;
  return <section className={inline ? "speech-footer speech-footer-inline" : "speech-footer"} data-inline={inline || undefined} aria-label="语音朗读控制" data-reserve-space={reserveSpace || undefined} data-phase={state.phase} data-reader-decoration="">
    <div className="speech-footer-info" title={state.error || state.label}><strong>{state.label || "语音朗读"}</strong><span role="status" hidden={Boolean(state.error)}>{state.phase === "loading" ? "正在连接流式语音…" : state.phase === "playing" ? "正在朗读" : state.phase === "paused" ? "已暂停" : "朗读失败"}{state.total > 1 ? ` · ${state.segment}/${state.total} 段` : ""}</span>{state.error && <p className="speech-footer-error" role="alert">{state.error}</p>}</div>
    <div className="speech-footer-actions">
      {state.phase === "playing" && <button type="button" aria-label="暂停朗读" onClick={speech.pause}>{inline ? "暂停" : "暂停朗读"}</button>}
      {state.phase === "paused" && <button type="button" aria-label="继续朗读" onClick={speech.resume}>{inline ? "播放" : "继续朗读"}</button>}
      <button type="button" aria-label={state.phase === "error" ? "关闭朗读提示" : "停止朗读"} onClick={() => speech.stop()}>{inline ? state.phase === "error" ? "关闭" : "停止" : state.phase === "error" ? "关闭朗读提示" : "停止朗读"}</button>
    </div>
  </section>;
}
export function SpeechButton({ text, label = "选中文本", disabled = false, children = "朗读" }: { text: string; label?: string; disabled?: boolean; children?: ReactNode }) {
  const speech = useSpeech(), sourceId = useId();
  const active = speech?.state.sourceId === sourceId && speech.state.phase !== "idle";
  return <button type="button" disabled={disabled || !text.trim() || !speech || (active && speech.state.phase === "loading")} aria-label={`朗读${label}`} title={active ? "重新朗读" : undefined} onClick={() => speech?.speak(text, label, sourceId)}>{children}</button>;
}
