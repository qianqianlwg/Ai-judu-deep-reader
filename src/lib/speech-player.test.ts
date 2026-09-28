import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "./speech";
import { SpeechPlayer, type SpeechState } from "./speech-player";
class FakeOutput {
  running = true;
  configure = vi.fn(); append = vi.fn<(bytes: Uint8Array) => Promise<void>>(async () => undefined);
  resume = vi.fn(async () => { this.running = true; }); pause = vi.fn(async () => { this.running = false; });
  private end?: () => void;
  finish = vi.fn(() => new Promise<void>(resolve => { this.end = resolve; }));
  stop = vi.fn(() => this.end?.());
  finishPlayback() { this.end?.(); }
}
let player: SpeechPlayer, outputs: FakeOutput[], states: SpeechState[], fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const current = () => states[states.length - 1];
const pcmResponse = () => new Response(new Uint8Array([0, 128, 255, 127]), { headers: { "content-type": "audio/pcm" } });
beforeEach(() => {
  outputs = []; states = [];
  fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes("settings") ? Response.json({ ...DEFAULT_SPEECH_PREFERENCES, playbackRate: 1.5, volume: 0.4 }) : pcmResponse());
  player = new SpeechPlayer({ fetcher, createOutput: () => { const output = new FakeOutput(); outputs.push(output); return output; }, onChange: state => states.push(state) });
});
it("首帧开始播放时响应仍未结束，不等完整音频", async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  fetcher.mockImplementation(async url => String(url).includes("settings") ? Response.json(DEFAULT_SPEECH_PREFERENCES) : new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }), { headers: { "content-type": "audio/pcm" } }));
  const done = player.speak("正文", "正文"); await vi.waitFor(() => expect(upstream).toBeDefined());
  upstream.enqueue(new Uint8Array([0, 128])); await vi.waitFor(() => expect(current().phase).toBe("playing"));
  expect(outputs[0].append).toHaveBeenCalledWith(new Uint8Array([0, 128])); expect(outputs[0].finish).not.toHaveBeenCalled();
  player.stop(); await done; expect(current().phase).toBe("idle");
});
it("后续分段提前取流，共用播放器且支持暂停继续", async () => {
  const done = player.speak("字".repeat(1500), "正文"); await vi.waitFor(() => expect(outputs[0]?.finish).toHaveBeenCalled());
  expect(outputs).toHaveLength(1); expect(outputs[0].configure).toHaveBeenCalledWith(expect.objectContaining({ playbackRate: 1.5, volume: 0.4 }));
  expect(fetcher.mock.calls.filter(call => call[0] === "/api/speech")).toHaveLength(2); expect(current().phase).toBe("playing");
  player.pause(); expect(current().phase).toBe("paused"); await player.resume(); expect(current().phase).toBe("playing");
  outputs[0].finishPlayback(); await done; expect(current().phase).toBe("idle"); expect(outputs[0].stop).toHaveBeenCalled();
});
it("停止中断在途读取，迟到响应不能恢复旧朗读", async () => {
  let finish: ((response: Response) => void) | undefined;
  fetcher.mockImplementation(async url => String(url).includes("settings") ? Response.json(DEFAULT_SPEECH_PREFERENCES) : new Promise(resolve => { finish = resolve; }));
  const done = player.speak("旧选文", "正文"); await vi.waitFor(() => expect(finish).toBeTypeOf("function")); player.stop();
  expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true); finish?.(pcmResponse()); await done;
  expect(outputs[0].append).not.toHaveBeenCalled(); expect(current().phase).toBe("idle");
});
it("切换选文关闭旧输出，旧响应不能抢占新状态", async () => {
  const old = player.speak("旧文", "正文"); await vi.waitFor(() => expect(outputs[0]?.finish).toHaveBeenCalled());
  const next = player.speak("新文", "AI句读"); await old; await vi.waitFor(() => expect(outputs[1]?.finish).toHaveBeenCalled());
  expect(outputs[0].stop).toHaveBeenCalled(); expect(current().label).toBe("AI句读"); player.stop(); await next;
});
it("网络和流中途错误有明确反馈并释放输出", async () => {
  fetcher.mockResolvedValue(Response.json({ error: "密钥无效" }, { status: 502 }));
  await player.speak("文", "正文"); expect(current()).toMatchObject({ phase: "error", error: "密钥无效" }); expect(outputs[0].stop).toHaveBeenCalled();
});
it("自动播放被阻止可继续，暂停后流到达不覆盖暂停状态", async () => {
  player = new SpeechPlayer({ fetcher, createOutput: () => { const output = new FakeOutput(); output.running = false; output.resume.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError")); outputs.push(output); return output; }, onChange: state => states.push(state) });
  const done = player.speak("文", "正文"); await vi.waitFor(() => expect(current().phase).toBe("paused"));
  await player.resume(); expect(current().phase).toBe("playing"); player.stop(); await done;
});
