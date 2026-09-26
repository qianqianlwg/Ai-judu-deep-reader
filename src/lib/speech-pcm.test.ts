import { expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "./speech";
import { PcmSpeechOutput } from "./speech-pcm";
class Source {
  buffer?: AudioBuffer; playbackRate = { value: 1 }; onended?: () => void;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  end() { this.onended?.(); }
}
function setup() {
  const sources: Source[] = [], buffers: Float32Array[] = [];
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { state: "running", currentTime: 0, destination: {},
    createGain: () => gain,
    createBuffer: (_channels: number, length: number) => { const data = new Float32Array(length); buffers.push(data); return { getChannelData: () => data }; },
    createBufferSource: () => { const source = new Source(); sources.push(source); return source; },
    resume: vi.fn(async () => { context.state = "running"; }), suspend: vi.fn(async () => { context.state = "suspended"; }), close: vi.fn(async () => { context.state = "closed"; }),
  };
  const controller = new AbortController();
  // WHY：这个显式测试边界仅模拟音频节点；业务实现仍由浏览器 AudioContext 提供严格接口。
  const output = new PcmSpeechOutput(context as unknown as AudioContext, controller.signal);
  return { output, context, sources, buffers, gain, controller };
}
it("首帧立即排入播放，按 PCM16LE 解析采样并应用音量语速", async () => {
  const test = setup(); test.output.configure({ ...DEFAULT_SPEECH_PREFERENCES, playbackRate: 1.5, volume: 0.4 });
  await test.output.append(new Uint8Array([0, 128, 255, 127]));
  expect(test.buffers[0][0]).toBe(-1); expect(test.buffers[0][1]).toBeCloseTo(32767 / 32768);
  expect(test.sources[0].start).toHaveBeenCalledWith(0.02); expect(test.sources[0].playbackRate.value).toBe(1.5); expect(test.gain.gain.value).toBe(0.4);
  let finished = false; const finish = test.output.finish().then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false);
  test.sources[0].end(); await finish; test.output.stop(); expect(test.context.close).toHaveBeenCalledOnce();
});
it("网络包拆开 16 位采样时不丢字节，跨分段共享连续时间线", async () => {
  const test = setup(); await test.output.append(new Uint8Array([0])); expect(test.sources).toHaveLength(0);
  await test.output.append(new Uint8Array([128, 255])); await test.output.append(new Uint8Array([127]));
  expect(test.buffers.map(data => data[0])).toEqual([-1, 32767 / 32768]);
  expect(test.sources[1].start.mock.calls[0][0]).toBeCloseTo(0.02 + 1 / 24000);
  test.output.stop();
});
it("暂停挂起上下文，继续恢复，停止取消所有节点并释放", async () => {
  const test = setup(); await test.output.append(new Uint8Array([1, 2]));
  await test.output.pause(); expect(test.output.running).toBe(false); await test.output.resume(); expect(test.output.running).toBe(true);
  test.controller.abort(); expect(test.sources[0].stop).toHaveBeenCalledOnce(); expect(test.context.close).toHaveBeenCalledOnce();
  test.output.stop(); expect(test.context.close).toHaveBeenCalledOnce();
});
it("背压限制提前排队时长，取消不会挂死等待", async () => {
  const test = setup(); let completed = false;
  const append = test.output.append(new Uint8Array(24000 * 2 * 10)).then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false); expect(test.sources.length).toBeLessThanOrEqual(33);
  test.controller.abort(); await append; expect(completed).toBe(true);
});
it("空音频与尾部半个采样给出错误", async () => {
  const test = setup(); await expect(test.output.finish()).rejects.toThrow("没有返回音频"); await test.output.append(new Uint8Array([0]));
  await expect(test.output.finish()).rejects.toThrow("采样不完整"); test.output.stop();
});
