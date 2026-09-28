import { expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "./speech";
import { buildSpeechRequest, MIMO_SPEECH_URL, synthesizeSpeech } from "./speech-provider";
const config = { preferences: { ...DEFAULT_SPEECH_PREFERENCES, voice: "苏打" as const }, apiKey: "unit-only-key" };
const signal = () => new AbortController().signal;
const pcm = [0, 128, 255, 127];
const response = () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(pcm).toString("base64") } } }] }) + '\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
it("MiMo 请求启用真正流式 PCM16，正文角色和音色不改变", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  expect(new Uint8Array(await new Response(await synthesizeSpeech("原文不改写。", config, fetcher, signal())).arrayBuffer())).toEqual(new Uint8Array(pcm));
  const [url, init] = fetcher.mock.calls[0]; expect(url).toBe(MIMO_SPEECH_URL);
  expect(init?.headers).toMatchObject({ Authorization: "Bearer unit-only-key", Accept: "text/event-stream" });
  expect(JSON.parse(String(init?.body))).toEqual({ model: "mimo-v2.5-tts", stream: true, messages: [{ role: "user", content: config.preferences.style }, { role: "assistant", content: "原文不改写。" }], audio: { format: "pcm16", voice: "苏打" } });
});
it("缺密钥或非法文本不发起网络请求", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(synthesizeSpeech("文本", { ...config, apiKey: "" }, fetcher, signal())).rejects.toMatchObject({ status: 503 });
  expect(() => buildSpeechRequest("字".repeat(1201), config)).toThrow("1200"); expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 500])("上游 %i 错误不泄露响应、密钥或正文", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("unit-only-key SECRET_BOOK_TEXT", { status }));
  await expect(synthesizeSpeech("文本", config, fetcher, signal())).rejects.toHaveProperty("status", status === 429 ? 429 : 502);
});
it("上游退化为完整 JSON 时明确报错，不假装流式", async () => {
  await expect(synthesizeSpeech("文本", config, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] })), signal())).rejects.toHaveProperty("status", 502);
});
it("取消返回流会中止上游请求", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  const stream = await synthesizeSpeech("文本", config, fetcher, signal()); await stream.cancel();
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it("超时和取消分别反馈，不泄露网络异常详情", async () => {
  await expect(synthesizeSpeech("文本", config, vi.fn<typeof fetch>().mockRejectedValue(new DOMException("unit-only-key", "TimeoutError")), signal())).rejects.toHaveProperty("status", 504);
  const controller = new AbortController(); controller.abort();
  await expect(synthesizeSpeech("文本", config, vi.fn<typeof fetch>().mockRejectedValue(new Error("unit-only-key")), controller.signal)).rejects.toHaveProperty("status", 499);
});
