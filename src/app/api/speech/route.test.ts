import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "@/lib/speech";
const state = vi.hoisted(() => ({ key: "unit-only-key" }));
vi.mock("@/lib/data-storage", () => ({ getJuduDataDir: () => "unused-unit-directory" }));
vi.mock("@/lib/speech-config", () => ({ createSpeechConfigStore: () => ({ read: async () => ({ preferences: DEFAULT_SPEECH_PREFERENCES, apiKey: state.key }) }) }));
import { POST } from "./route";
const fetcher = vi.fn<typeof fetch>();
const request = (body: unknown, origin?: string) => new Request("http://localhost/api/speech", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  state.key = "unit-only-key"; fetcher.mockReset();
  fetcher.mockResolvedValue(new Response('data: {"choices":[{"delta":{"audio":{"data":"AID/fw=="}}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetcher); vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("实际路由返回私有 PCM 音频流，不返回密钥或 base64 JSON", async () => {
  const response = await POST(request({ text: "你好。" }, "http://localhost"));
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("audio/pcm"); expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255, 127]));
  expect(response.headers.get("x-accel-buffering")).toBe("no");
});
it.each([{}, { text: "" }, { text: "字".repeat(1201) }, { text: "合法", apiKey: "client-secret" }])("拒绝无效文本或客户端密钥 %j", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it("拒绝跨站请求且不消耗配额", async () => {
  expect((await POST(request({ text: "合法" }, "https://outside.invalid"))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
});
it("缺密钥、上游限流和非法 JSON 给出明确反馈", async () => {
  state.key = ""; expect((await POST(request({ text: "合法" }))).status).toBe(503); state.key = "unit-only-key";
  fetcher.mockResolvedValue(new Response("secret upstream", { status: 429 }));
  const limited = await POST(request({ text: "合法" })); expect(limited.status).toBe(429); expect(await limited.text()).not.toContain("secret upstream");
  expect((await POST(new Request("http://localhost/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
});
it("Next 回环 URL 规范化后仍按真实 Host 接受同源请求", async () => {
  const response = await POST(new Request("http://localhost:3217/api/speech", { method: "POST", headers: { host: "127.0.0.1:3217", origin: "http://127.0.0.1:3217", "Content-Type": "application/json" }, body: JSON.stringify({ text: "同源选文" }) }));
  expect(response.status).toBe(200);
});
