import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_PREFERENCES } from "@/lib/speech";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("@/lib/data-storage", () => ({ getJuduDataDir: () => state.directory }));
import { GET, PUT } from "./route";
const request = (body: unknown, origin?: string) => new Request("http://localhost/api/settings/speech", { method: "PUT", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-speech-route-test-")); vi.stubEnv("MIMO_API_KEY", "unit-env-key"); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(async () => { await fs.rm(state.directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("GET 仅返回公开配置与已配置状态", async () => {
  const response = await GET(); expect(response.status).toBe(200); const text = await response.text();
  expect(text).not.toContain("unit-env-key"); expect(JSON.parse(text)).toMatchObject({ hasApiKey: true, voice: "mimo_default", model: "mimo-v2.5-tts" });
});
it("PUT 保存新密钥但不回显，空白输入保留已有密钥", async () => {
  const response = await PUT(request({ ...DEFAULT_SPEECH_PREFERENCES, voice: "苏打", apiKey: "unit-saved-key" }, "http://localhost"));
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("unit-saved-key");
  await PUT(request({ ...DEFAULT_SPEECH_PREFERENCES, apiKey: " " }));
  expect(JSON.parse(await fs.readFile(path.join(state.directory, "speech-settings.json"), "utf8"))).toHaveProperty("apiKey", "unit-saved-key");
});
it("配置不可读时明确报错且不覆盖", async () => {
  await fs.writeFile(path.join(state.directory, "speech-settings.json"), "{");
  expect((await GET()).status).toBe(500); expect((await PUT(request(DEFAULT_SPEECH_PREFERENCES))).status).toBe(500);
});
it.each([{ voice: "invalid" }, { volume: 4 }, { playbackRate: 0.1 }, { baseUrl: "https://attacker.invalid" }])("拒绝非法参数或更改供应商地址 %j", async value => {
  expect((await PUT(request({ ...DEFAULT_SPEECH_PREFERENCES, ...value }))).status).toBe(400);
});
it("拒绝跨站修改", async () => {
  expect((await PUT(request(DEFAULT_SPEECH_PREFERENCES, "https://outside.invalid"))).status).toBe(403);
});
it("Next 回环 URL 规范化后仍按真实 Host 接受同源配置保存", async () => {
  const response = await PUT(new Request("http://localhost:3217/api/settings/speech", { method: "PUT", headers: { host: "127.0.0.1:3217", origin: "http://127.0.0.1:3217", "Content-Type": "application/json" }, body: JSON.stringify(DEFAULT_SPEECH_PREFERENCES) }));
  expect(response.status).toBe(200);
});
