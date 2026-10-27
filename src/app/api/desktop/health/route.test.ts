import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const token = "a".repeat(64);
afterEach(() => vi.unstubAllEnvs());
describe("桌面后台就绪身份", () => {
  it("普通网页服务没有开启桌面探针", async () => {
    vi.stubEnv("JUDU_DESKTOP_TOKEN", "");
    expect((await GET(new Request("http://localhost/api/desktop/health"))).status).toBe(404);
  });
  it.each([undefined, "b".repeat(64), "中".repeat(64), "a", "a".repeat(65)])("拒绝缺失或错误令牌 %s", async value => {
    vi.stubEnv("JUDU_DESKTOP_TOKEN", token);
    const headers = value ? { "x-judu-desktop-token": value } : undefined;
    // WHY：HTTP 头不能包含中文；使用 Latin-1 多字节字符仍可验证字节长度，而非 JS 字符串长度。
    const supplied = value?.includes("中") ? { "x-judu-desktop-token": "é".repeat(64) } : headers;
    expect((await GET(new Request("http://localhost/api/desktop/health", { headers: supplied }))).status).toBe(404);
  });
  it("仅返回协议和进程身份，不泄露令牌与书库", async () => {
    vi.stubEnv("JUDU_DESKTOP_TOKEN", token);
    const response = await GET(new Request("http://localhost/api/desktop/health", { headers: { "x-judu-desktop-token": token } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protocol: 1, pid: process.pid, platform: process.platform });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
