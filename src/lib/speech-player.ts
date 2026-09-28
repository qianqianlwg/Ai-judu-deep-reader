import { speechPreferencesSchema, splitSpeechText } from "./speech";
import type { SpeechOutput } from "./speech-pcm";

export type SpeechState = { phase: "idle" | "loading" | "playing" | "paused" | "error"; label: string; segment: number; total: number; error: string; sourceId: string };
export const IDLE_SPEECH_STATE: SpeechState = { phase: "idle", label: "", segment: 0, total: 0, error: "", sourceId: "" };
type Dependencies = { fetcher: typeof fetch; createOutput: (signal: AbortSignal) => SpeechOutput; onChange: (state: SpeechState) => void };
async function responseError(response: Response): Promise<Error> {
  let value: unknown;
  try { value = await response.json(); }
  catch { return new Error("朗读请求失败，请检查服务后重试。"); }
  return new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "朗读请求失败，请重试。");
}
export class SpeechPlayer {
  private state: SpeechState = { ...IDLE_SPEECH_STATE };
  private controller?: AbortController;
  private output?: SpeechOutput;
  private paused = false;
  private hasAudio = false;
  constructor(private readonly dependencies: Dependencies) {}
  private update(patch: Partial<SpeechState>) { this.state = { ...this.state, ...patch }; this.dependencies.onChange(this.state); }
  stop(sourceId?: string) {
    if (sourceId !== undefined && this.state.sourceId !== sourceId) return;
    this.controller?.abort(); this.controller = undefined; this.output?.stop(); this.output = undefined;
    this.paused = false; this.hasAudio = false; this.update({ ...IDLE_SPEECH_STATE });
  }
  pause() {
    const output = this.output;
    if (this.state.phase !== "playing" || !output) return;
    this.paused = true; this.update({ phase: "paused" });
    void output.pause().catch(() => { if (this.output === output) this.update({ phase: "error", error: "暂停朗读失败，请停止后重试。" }); });
  }
  async resume() {
    const output = this.output;
    if (this.state.phase !== "paused" || !output) return;
    try {
      await output.resume();
      if (this.output === output && output.running) { this.paused = false; this.update({ phase: this.hasAudio ? "playing" : "loading", error: "" }); }
    } catch { if (this.output === output) this.update({ error: "播放未能开始，请检查浏览器音频权限后点击继续。" }); }
  }
  async speak(text: string, label: string, sourceId = "") {
    this.stop();
    const controller = new AbortController(); this.controller = controller;
    const signal = controller.signal;
    let output: SpeechOutput | undefined;
    try {
      const chunks = splitSpeechText(text);
      this.update({ phase: "loading", label, sourceId, segment: 1, total: chunks.length });
      // WHY：点击事件内立即解锁音频上下文，不等网络返回，避免首帧到达后被自动播放策略拦截。
      output = this.dependencies.createOutput(signal); this.output = output;
      void output.resume().catch(() => {
        if (!signal.aborted && this.output === output) { this.paused = true; this.update({ phase: "paused", error: "请点击继续朗读以允许音频播放。" }); }
      });
      const settings = await this.dependencies.fetcher("/api/settings/speech", { signal, cache: "no-store" });
      if (!settings.ok) throw await responseError(settings);
      const value: unknown = await settings.json();
      const parsed = speechPreferencesSchema.safeParse(value && typeof value === "object" ? {
        voice: "voice" in value ? value.voice : undefined, playbackRate: "playbackRate" in value ? value.playbackRate : undefined,
        volume: "volume" in value ? value.volume : undefined, style: "style" in value ? value.style : undefined,
      } : value);
      if (!parsed.success) throw new Error("语音设置无效，请到设置页重新保存。");
      if (signal.aborted) return;
      output.configure(parsed.data);
      for (let index = 0; index < chunks.length; index++) {
        if (signal.aborted) return;
        this.update({ segment: index + 1 });
        const response = await this.dependencies.fetcher("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: chunks[index] }), signal });
        if (signal.aborted) return;
        if (!response.ok) throw await responseError(response);
        if (!response.body || !response.headers.get("content-type")?.startsWith("audio/pcm")) throw new Error("语音接口未返回流式音频。");
        const reader = response.body.getReader(); let complete = false;
        const cancel = () => { void reader.cancel().catch(() => console.error("取消朗读响应失败")); };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          while (!signal.aborted) {
            const frame = await reader.read();
            if (signal.aborted) break;
            if (frame.done) { complete = true; break; }
            if (!frame.value.length) continue;
            const pending = output.append(frame.value);
            this.hasAudio = true;
            if (!this.paused && output.running) this.update({ phase: "playing" });
            else if (!this.paused && !output.running) { this.paused = true; this.update({ phase: "paused", error: "请点击继续朗读以允许音频播放。" }); }
            await pending;
          }
        } catch { if (!signal.aborted) throw new Error("语音连接中断，请停止后重新朗读。"); }
        finally {
          signal.removeEventListener("abort", cancel);
          if (!complete) {
            try { await reader.cancel(); } catch { console.error("清理朗读响应失败"); }
          }
          reader.releaseLock();
        }
        // WHY：当前分段音频尚在播放时就取下一段，沿同一时间线排队，不再等整段播放结束才请求。
      }
      if (signal.aborted) return;
      await output.finish();
      if (!signal.aborted) this.update({ ...IDLE_SPEECH_STATE });
    } catch (error: unknown) {
      if (!signal.aborted) this.update({ phase: "error", error: error instanceof Error ? error.message : "朗读失败，请重试。" });
    } finally {
      output?.stop();
      if (this.controller === controller) { this.controller = undefined; this.output = undefined; }
    }
  }
}
