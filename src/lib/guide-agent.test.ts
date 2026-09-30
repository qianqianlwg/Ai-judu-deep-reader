import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), bind: vi.fn() }));
vi.mock("./agent/model", () => ({ createReadingModel: () => ({ bindTools: fixture.bind }) }));
import { guideInitialContext, planGuide } from "./guide-agent";
import type { GuidePlanInput } from "./guide-worker";
const input: GuidePlanInput = { bookId: "b", nodes: [], source: { id: "m", bookId: "b", editionId: "e", threadId: "t", messageId: "m", chapterId: "c", chapterTitle: "一", createdAt: "now", anchor: { paragraphId: "p", startOffset: 0, endOffset: 6, selectedText: "认识来自实践" } }, readSources: () => [], signal: new AbortController().signal };
const config = { provider: "openai" as const, baseUrl: "https://example.invalid/v1", apiKey: "test", model: "test" };
afterEach(() => vi.clearAllMocks());
describe("导读工具协议", () => {
  it("仅发送已句读选文与提纲，AI提交增量而不是全树", async () => {
    fixture.bind.mockReturnValue({ invoke: fixture.invoke });
    fixture.invoke.mockResolvedValue(new AIMessage({ content: "", tool_calls: [{ name: "update_reading_guide", id: "call", args: { reason: "新主题", upserts: [{ id: "new-practice", parentId: null, title: "实践", summary: "认识的来源", sourceIds: ["m"] }], removeIds: [] } }] }));
    const result = await planGuide(config, input);
    expect(result.patch.upserts[0].id).toBe("m:new-practice");
    const tools = fixture.bind.mock.calls[0][0] as { name: string }[];
    expect(tools.map(t => t.name)).toEqual(["list_guide_nodes", "read_guide_sources", "update_reading_guide"]);
    expect(JSON.stringify(fixture.invoke.mock.calls[0][0])).toContain("认识来自实践");
    expect(guideInitialContext(input)).not.toHaveProperty("readingText");
  });
  it("伪造来源交回模型修复，不保存不完整结果", async () => {
    fixture.bind.mockReturnValue({ invoke: fixture.invoke });
    fixture.invoke.mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [{ name: "update_reading_guide", id: "bad", args: { reason: "错误", upserts: [{ id: "new-a", parentId: null, title: "伪造", summary: "", sourceIds: ["unread"] }], removeIds: [] } }] })).mockResolvedValueOnce(new AIMessage({ content: "", tool_calls: [{ name: "update_reading_guide", id: "fixed", args: { reason: "无需新增", upserts: [], removeIds: [] } }] }));
    expect((await planGuide(config, input)).patch.upserts).toEqual([]); expect(fixture.invoke).toHaveBeenCalledTimes(2);
  });
  it("大提纲分页而非无限塞入上下文", () => {
    const large = { ...input, nodes: Array.from({ length: 1000 }, (_, index) => ({ id: String(index), parentId: index ? "0" : null, title: "主题", summary: "已读归纳".repeat(30), sourceIds: ["m"] })) };
    expect(guideInitialContext(large)).toMatchObject({ partial: true, nodeCount: 1000 });
  });
});
