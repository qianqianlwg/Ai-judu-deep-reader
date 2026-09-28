// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "@/lib/speech";
import { SpeechButton, SpeechPlaybackBar, SpeechProvider } from "./speech-controls";
import { SelectionActions } from "./selection-actions";
import { MessageActions } from "./message-actions";
class FakeAudioContext {
  state = "running"; currentTime = 0; destination = {};
  createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return { playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; }
  async resume() { this.state = "running"; } async suspend() { this.state = "suspended"; } async close() { this.state = "closed"; }
}
let host: HTMLDivElement, root: Root;
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:unit"); static revokeObjectURL = vi.fn(); });
  fetcher.mockReset(); fetcher.mockImplementation(async url => String(url).includes("settings") ? Response.json(DEFAULT_SPEECH_PREFERENCES) : new Response(new Uint8Array([0, 128, 255, 127]), { headers: { "content-type": "audio/pcm" } })); vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("正文工具栏在句读旁朗读真实选区，播放栏可暂停继续停止", async () => {
  await act(async () => root.render(<SpeechProvider><div className="workspace-main"><SelectionActions left={100} top={100} selectedText="所选原文。" onAnalyze={vi.fn()} onHighlight={vi.fn()} onFavorite={vi.fn()} onNote={vi.fn()}/><SpeechPlaybackBar/></div></SpeechProvider>));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="朗读选中文本"]')!;
  expect(button.previousElementSibling?.textContent).toBe("句读一下");
  await act(async () => { button.click(); });
  expect(fetcher.mock.calls.find(call => call[0] === "/api/speech")?.[1]?.body).toBe(JSON.stringify({ text: "所选原文。" }));
  expect(host.querySelector('.workspace-main > .speech-footer[aria-label="语音朗读控制"]')).not.toBeNull();
  expect(host.querySelector('.selection-primary-actions [aria-label="语音朗读控制"]')).toBeNull();
  expect(host.querySelector("aside.speech-player")).toBeNull();
  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "暂停朗读")!.click());
  expect(host.textContent).toContain("已暂停");
  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "继续朗读")!.click());
  expect(host.textContent).toContain("正在朗读");
  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "停止朗读")!.click());
  expect(host.querySelector('[aria-label="语音朗读控制"]')).toBeNull();
});
it("AI 回答朗读可读正文，保留原复制能力", async () => {
  await act(async () => root.render(<SpeechProvider><MessageActions message={{ role: "assistant", content: "## 解读\n**正文说明**" }}/></SpeechProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="朗读AI回答"]')!.click());
  expect(fetcher.mock.calls.find(call => call[0] === "/api/speech")?.[1]?.body).toBe(JSON.stringify({ text: "解读\n正文说明" }));
  expect(host.querySelector('[aria-label="复制回答"]')).not.toBeNull();
});
it("无 provider 或空文本不触发请求", async () => {
  await act(async () => root.render(<SpeechButton text="正文"/>)); expect(host.querySelector("button")?.disabled).toBe(true);
  await act(async () => root.render(<SpeechProvider><SpeechButton text=" "/></SpeechProvider>)); expect(host.querySelector("button")?.disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
});
it("配置缺失错误显示为明确提示", async () => {
  fetcher.mockResolvedValue(Response.json({ error: "请配置密钥" }, { status: 503 }));
  await act(async () => root.render(<SpeechProvider><SpeechButton text="文"/><SpeechPlaybackBar/></SpeechProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("请配置密钥");
});

it("播放器占用阅读区底部独立网格行，不浮动遮挡内容", async () => {
  const { promises: fs } = await import("node:fs");
  const source = await fs.readFile("src/components/speech-controls.css", "utf8");
  // WHY：CSS 拼接时文件头 BOM 会成为选择器的一部分，导致首条桌面定位规则无法命中。
  expect(source.charCodeAt(0)).not.toBe(0xfeff);
  expect(source).toMatch(/^\.speech-footer\s*\{/u);
  expect(source).toContain("grid-area:2 / 1");
  expect(source).not.toMatch(/position\s*:\s*(fixed|absolute)/u);
});
it("关闭选文菜单后仍可在底部控制，切换到 AI 回答始终只有一条播放栏", async () => {
  const render = (showSelection: boolean) => <SpeechProvider><div className="workspace-main">{showSelection && <SelectionActions left={100} top={100} selectedText="原文。" onAnalyze={vi.fn()} onHighlight={vi.fn()} onFavorite={vi.fn()} onNote={vi.fn()}/>}<MessageActions message={{role:"assistant",content:"AI 正文。"}}/><SpeechPlaybackBar/></div></SpeechProvider>;
  await act(async () => root.render(render(true)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="朗读选中文本"]')!.click());
  await act(async () => root.render(render(false)));
  expect(host.querySelector('[aria-label="语音朗读控制"]')?.textContent).toContain("选中文本");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="朗读AI回答"]')!.click());
  expect(host.querySelectorAll('[aria-label="语音朗读控制"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="语音朗读控制"]')?.textContent).toContain("AI回答");
});

it("生成锁住再次句读与标注时，新选区仍可朗读且不更改请求", async () => {
  const onAnalyze = vi.fn(), onHighlight = vi.fn();
  await act(async () => root.render(<SpeechProvider><SelectionActions left={100} top={100} selectedText="新选的文字。" disabled speechDisabled={false} onAnalyze={onAnalyze} onHighlight={onHighlight} onFavorite={vi.fn()} onNote={vi.fn()} /></SpeechProvider>));
  const speech = host.querySelector<HTMLButtonElement>('[aria-label="朗读选中文本"]')!;
  expect(speech.disabled).toBe(false);
  expect(Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "句读一下")?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="黄色标亮"]')?.disabled).toBe(true);
  await act(async () => speech.click());
  expect(fetcher.mock.calls.find(call => call[0] === "/api/speech")?.[1]?.body).toBe(JSON.stringify({ text: "新选的文字。" }));
  expect(onAnalyze).not.toHaveBeenCalled(); expect(onHighlight).not.toHaveBeenCalled();
});

it("流式回答可以朗读已收到文字，后续增量不改变已发出的语音请求", async () => {
  await act(async () => root.render(<SpeechProvider><MessageActions message={{ role: "assistant", content: "已收到的第一段。", status: "streaming" }} /></SpeechProvider>));
  const read = host.querySelector<HTMLButtonElement>('[aria-label="朗读AI回答"]')!; expect(read.disabled).toBe(false);
  await act(async () => read.click());
  expect(fetcher.mock.calls.find(call => call[0] === "/api/speech")?.[1]?.body).toBe(JSON.stringify({ text: "已收到的第一段。" }));
  await act(async () => root.render(<SpeechProvider><MessageActions message={{ role: "assistant", content: "已收到的第一段。第二段也到了。", status: "streaming" }} /></SpeechProvider>));
  expect(fetcher.mock.calls.filter(call => call[0] === "/api/speech")).toHaveLength(1);
});
