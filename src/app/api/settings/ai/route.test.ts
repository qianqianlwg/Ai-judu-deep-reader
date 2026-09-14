import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type MemoryDatabase = { exec(sql: string): void; close(): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } };
const state = vi.hoisted(() => ({ db: undefined as MemoryDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => {
  if (!state.db) throw new Error("测试数据库未初始化");
  return state.db;
} }));
import { GET, POST, PUT } from "./route";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => MemoryDatabase };
// WHY：密钥全部是假夹具；测试不读取 .env、真实配置或访问模型服务。
const TEST_KEY = "sk-unit-only-not-a-real-key-1234";
const fetcher = vi.fn<typeof fetch>();
function seed(provider = "openai", key = TEST_KEY) {
  state.db?.prepare("INSERT INTO ai_provider_configs VALUES (?, ?, ?, ?, ?, ?)")
    .run("default", provider, "https://unit.invalid/v1", key, "stored-model", "2026-01-01T00:00:00Z");
}
const request = (method: "PUT" | "POST", body: unknown) => new NextRequest("http://localhost/api/settings/ai", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const stored = () => state.db?.prepare("SELECT * FROM ai_provider_configs WHERE id = 'default'").get();

beforeEach(() => {
  state.db = new DatabaseSync(":memory:");
  state.db.exec("CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT, updated_at TEXT)");
  fetcher.mockReset(); fetcher.mockResolvedValue(new Response("连接成功"));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { state.db?.close(); state.db = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("AI settings · 保存与公开配置", () => {
  it("无配置时返回默认公开值，不伪造已保存密钥", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "openai", baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini", hasApiKey: false, maskedApiKey: "" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("GET 仅返回掩码和公开字段，不返回完整 Key", async () => {
    seed();
    const text = await (await GET()).text();
    expect(text).not.toContain(TEST_KEY);
    const value: unknown = JSON.parse(text);
    expect(value).toMatchObject({ provider: "openai", baseUrl: "https://unit.invalid/v1", model: "stored-model", hasApiKey: true });
    expect(value).not.toHaveProperty("apiKey");
    expect(value).not.toHaveProperty("api_key");
    expect(value).toHaveProperty("maskedApiKey", expect.stringContaining("••"));
  });
  it("PUT 保存 trim 后的配置，响应仍不返回完整 Key", async () => {
    const response = await PUT(request("PUT", { provider: "claude", baseUrl: " https://claude.unit.invalid ",
      model: " test-model ", apiKey: " " + TEST_KEY + " " }));
    expect(response.status).toBe(200);
    expect(stored()).toMatchObject({ id: "default", provider: "claude", base_url: "https://claude.unit.invalid", api_key: TEST_KEY, model: "test-model" });
    expect(await response.text()).not.toContain(TEST_KEY);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{}, { apiKey: "" }, { apiKey: "   " }])("省略或空 Key 保存保留原密钥：%j", async (body) => {
    seed();
    const response = await PUT(request("PUT", { ...body, model: "new-model" }));
    expect(response.status).toBe(200);
    expect(stored()).toMatchObject({ api_key: TEST_KEY, model: "new-model" });
    expect(await response.text()).not.toContain(TEST_KEY);
    expect(state.db?.prepare("SELECT COUNT(*) AS count FROM ai_provider_configs").get()).toEqual({ count: 1 });
  });
  it("新 Key 替换旧 Key，响应不泄露新旧值", async () => {
    seed();
    const nextKey = "sk-unit-replacement-not-real-5678";
    const response = await PUT(request("PUT", { apiKey: nextKey }));
    expect(stored()).toMatchObject({ api_key: nextKey });
    const text = await response.text();
    expect(text).not.toContain(TEST_KEY); expect(text).not.toContain(nextKey);
  });
  it("当前协议回退契约：非法 provider 保留已有协议，空 URL/模型保留已有值", async () => {
    seed("claude");
    const response = await PUT(request("PUT", { provider: "unknown", baseUrl: " ", model: "" }));
    expect(response.status).toBe(200);
    expect(stored()).toMatchObject({ provider: "claude", base_url: "https://unit.invalid/v1", model: "stored-model" });
  });
  it("无旧 Key 时不能保存空配置，也不能调用模型", async () => {
    const response = await PUT(request("PUT", { model: "model", apiKey: " " }));
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(stored()).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("损坏 JSON 返回可恢复错误且不覆盖旧配置", async () => {
    seed();
    const response = await PUT(new NextRequest("http://localhost/api/settings/ai", { method: "PUT", body: "{" }));
    expect(response.status).toBe(400);
    expect(stored()).toMatchObject({ api_key: TEST_KEY, model: "stored-model" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("AI settings · mock 连接测试与密钥保护", () => {
  it("OpenAI 测试复用旧 Key、发送正确鉴权，临时配置不落库", async () => {
    seed();
    const response = await POST(request("POST", { model: "temporary-model", apiKey: "" }));
    expect(await response.json()).toEqual({ ok: true, message: "连接成功" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://unit.invalid/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer " + TEST_KEY });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "temporary-model", stream: false, max_tokens: 32,
      messages: [{ role: "user", content: "请只回复：连接成功" }] });
    expect(init?.signal).toBeDefined();
    expect(stored()).toMatchObject({ model: "stored-model", api_key: TEST_KEY });
  });
  it("Claude 测试使用 x-api-key 和 messages 路径，不混用 Bearer", async () => {
    seed();
    const response = await POST(request("POST", { provider: "claude", baseUrl: "https://claude.unit.invalid", apiKey: "" }));
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://claude.unit.invalid/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": TEST_KEY, "anthropic-version": "2023-06-01" });
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(stored()).toMatchObject({ provider: "openai" });
  });
  it("无密钥测试连接返回 400，不尝试网络", async () => {
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it("上游成功正文不直接回显，即便正文包含测试 Key", async () => {
    seed(); fetcher.mockResolvedValueOnce(new Response("unexpected echo " + TEST_KEY));
    expect(await (await POST(request("POST", {}))).json()).toEqual({ ok: true, message: "连接成功" });
  });
  it("上游 HTTP 失败返回 502，不误报连接成功", async () => {
    seed(); fetcher.mockResolvedValueOnce(new Response("模型不存在", { status: 404 }));
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(502);
    expect(await response.json()).toHaveProperty("error");
    expect(stored()).toMatchObject({ api_key: TEST_KEY });
  });
  it("安全回归：上游错误即使回显 Key，接口也不能返回该 Key", async () => {
    seed(); fetcher.mockResolvedValueOnce(new Response("invalid API key: " + TEST_KEY, { status: 401 }));
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(502);
    // WHY：这是期望的安全边界，不把历史实现的泄露行为固化为正常契约，也不使用 it.fails 掩盖。
    const result: unknown = await response.json();
    expect(result).toEqual({ error: "模型服务返回 401" });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });
  it("安全回归：fetch 异常文本不能把 Key 带入响应", async () => {
    seed(); fetcher.mockRejectedValueOnce(new Error("upstream rejected Authorization: Bearer " + TEST_KEY));
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(TEST_KEY);
  });
  it.each(["abc", "12345678"])("安全回归：长度不超过 8 的 Key 仅返回掩码：%s", async (key) => {
    seed("openai", key);
    const response = await GET();
    const value: unknown = await response.json();
    expect(value).toHaveProperty("hasApiKey", true);
    expect(value).toHaveProperty("maskedApiKey", "••••");
    expect(JSON.stringify(value)).not.toContain(key);
  });
});
