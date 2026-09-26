// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "@/lib/speech";
const speak = vi.hoisted(() => vi.fn());
vi.mock("./speech-controls", () => ({ useSpeech: () => ({ speak }), SpeechPlaybackBar: () => null }));
import { SpeechSettings } from "./speech-settings";
const fetcher = vi.fn<typeof fetch>();
let host: HTMLDivElement, root: Root;
const click = async (text: string) => { await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === text)!.click()); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetcher.mockReset(); speak.mockReset();
  fetcher.mockResolvedValue(Response.json({ ...DEFAULT_SPEECH_PREFERENCES, hasApiKey: true, model: "mimo-v2.5-tts" }));
  vi.stubGlobal("fetch", fetcher); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("展示常用参数和安全密钥状态，保存并试听使用新配置", async () => {
  await act(async () => root.render(<SpeechSettings/>));
  expect(host.querySelectorAll('[aria-label="朗读音色"] option')).toHaveLength(9);
  expect(host.querySelector<HTMLInputElement>('[aria-label="MiMo API Key"]')?.value).toBe("");
  const voice = host.querySelector<HTMLSelectElement>('[aria-label="朗读音色"]')!;
  await act(async () => { voice.value = "苏打"; voice.dispatchEvent(new Event("change", { bubbles: true })); });
  fetcher.mockResolvedValueOnce(Response.json({ ...DEFAULT_SPEECH_PREFERENCES, voice: "苏打", hasApiKey: true }));
  await click("保存并试听");
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ voice: "苏打" });
  expect(speak).toHaveBeenCalledWith(expect.stringContaining("欢迎使用句读"), "音色试听", expect.any(String));
  expect(host.textContent).toContain("语音配置已保存");
});
it("未配置密钥时禁止试听，保存失败有明确反馈且不发起播放", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ ...DEFAULT_SPEECH_PREFERENCES, hasApiKey: false }));
  await act(async () => root.render(<SpeechSettings/>));
  expect(Array.from(host.querySelectorAll("button")).find(button => button.textContent === "保存并试听")?.disabled).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ error: "保存失败，请重试" }, { status: 500 }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await click("保存语音配置"); expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败，请重试"); expect(speak).not.toHaveBeenCalled();
});
it("加载失败不允许覆盖现有配置", async () => {
  fetcher.mockRejectedValueOnce(new Error("读取失败")); vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => root.render(<SpeechSettings/>));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("读取失败"); expect(host.querySelector("fieldset")?.disabled).toBe(true);
});
