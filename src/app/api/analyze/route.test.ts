import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./stream/route", () => ({ POST: state.stream }));
import { POST } from "./route";
afterEach(() => { vi.resetAllMocks(); });
const event = (name: string, value: unknown) => "event: " + name + "\ndata: " + JSON.stringify(value) + "\n\n";
const request = () => new NextRequest("http://localhost/api/analyze", { method: "POST", body: "{}" });
describe("非流式入口共享 Agent", () => {
  it("正文不必是JSON，正常文字与工具结构结果独立返回", async () => {
    const result = { summary: "结构摘要", breakdown: [], concepts: [], context: "", uncertainty: "" };
    state.stream.mockResolvedValue(new Response(event("meta", { threadId: "t", messageId: "a" }) + event("raw_delta", { text: "解释 {这不是JSON}。" }) + event("structured", { result }) + event("done", {})));
    const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ source: "agent", threadId: "t", analysisId: "a", content: "解释 {这不是JSON}。", result });
    expect(state.stream).toHaveBeenCalledOnce();
  });
  it("上游错误与缺失完成事件不伪造demo成功", async () => { state.stream.mockResolvedValueOnce(new Response(event("error", { message: "工具未保存" }))); const failed = await POST(request()); expect(failed.status).toBe(502); expect(await failed.json()).toHaveProperty("error", "工具未保存"); state.stream.mockResolvedValueOnce(new Response(event("raw_delta", { text: "半截" }))); expect((await POST(request())).status).toBe(502); });
  it("保持服务端输入校验的状态码", async () => { const error = new Response("错误参数", { status: 400 }); state.stream.mockResolvedValue(error); expect(await POST(request())).toBe(error); });
});
