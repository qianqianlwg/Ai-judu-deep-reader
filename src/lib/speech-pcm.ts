import type { SpeechPreferences } from "./speech";

export interface SpeechOutput {
  readonly running: boolean;
  configure(preferences: SpeechPreferences): void;
  resume(): Promise<void>;
  pause(): Promise<void>;
  append(bytes: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  stop(): void;
}
const SAMPLE_RATE = 24000;
const LOOKAHEAD_SECONDS = 8;
type Context = Pick<AudioContext, "state" | "currentTime" | "destination" | "createGain" | "createBuffer" | "createBufferSource" | "resume" | "suspend" | "close">;
export class PcmSpeechOutput implements SpeechOutput {
  private readonly gain: GainNode;
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private rate = 1;
  private carry?: number;
  private stopped = false;
  private received = false;
  private readonly waiting = new Set<() => void>();
  private readonly abortListener: () => void;
  constructor(private readonly context: Context, private readonly signal: AbortSignal) {
    this.gain = context.createGain(); this.gain.connect(context.destination);
    this.abortListener = () => this.stop(); signal.addEventListener("abort", this.abortListener, { once: true });
  }
  get running() { return this.context.state === "running"; }
  configure(preferences: SpeechPreferences) { this.rate = preferences.playbackRate; this.gain.gain.value = preferences.volume; }
  async resume() { if (!this.stopped) await this.context.resume(); }
  async pause() { if (!this.stopped) await this.context.suspend(); }
  private wake() { for (const resolve of this.waiting) resolve(); this.waiting.clear(); }
  async append(bytes: Uint8Array) {
    if (this.stopped || !bytes.length) return;
    const data = new Uint8Array(bytes.length + (this.carry === undefined ? 0 : 1));
    let offset = 0;
    if (this.carry !== undefined) data[offset++] = this.carry;
    data.set(bytes, offset); this.carry = data.length % 2 ? data[data.length - 1] : undefined;
    const count = Math.floor(data.length / 2), view = new DataView(data.buffer);
    // WHY：网络分片可能切开 16 位采样；保留半个采样，避免边界噪声或丢字节。
    for (let index = 0; index < count && !this.stopped; index += 6000) {
      const length = Math.min(6000, count - index), buffer = this.context.createBuffer(1, length, SAMPLE_RATE);
      const samples = buffer.getChannelData(0);
      for (let sample = 0; sample < length; sample++) samples[sample] = view.getInt16((index + sample) * 2, true) / 32768;
      const node = this.context.createBufferSource(); node.buffer = buffer; node.playbackRate.value = this.rate; node.connect(this.gain);
      node.onended = () => { this.nodes.delete(node); node.disconnect(); this.wake(); };
      this.nodes.add(node); this.received = true;
      // WHY：在同一 AudioContext 时间线上拼接 PCM，首帧仅缓冲 20ms；不等待整段音频下载。
      const start = Math.max(this.nextTime, this.context.currentTime + (this.nodes.size === 1 ? 0.02 : 0));
      node.start(start); this.nextTime = start + length / SAMPLE_RATE / this.rate;
      while (!this.stopped && this.nextTime - this.context.currentTime > LOOKAHEAD_SECONDS) await new Promise<void>(resolve => this.waiting.add(resolve));
    }
  }
  async finish() {
    if (this.stopped) return;
    if (this.carry !== undefined) throw new Error("语音流采样不完整，请重试。");
    if (!this.received) throw new Error("语音服务没有返回音频，请重试。");
    while (!this.stopped && this.nodes.size) await new Promise<void>(resolve => this.waiting.add(resolve));
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.signal.removeEventListener("abort", this.abortListener);
    for (const node of this.nodes) { node.onended = null; node.stop(); node.disconnect(); }
    this.nodes.clear(); this.wake(); this.gain.disconnect();
    if (this.context.state !== "closed") void this.context.close().catch(() => console.error("关闭朗读音频上下文失败"));
  }
}
