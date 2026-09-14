import { describe, expect, it, vi } from "vitest";
import { fetchBookKnowledge, filterBookKnowledge, isBookKnowledge, isKnowledgeAnchor, type BookKnowledge } from "./knowledge";

const anchor = { editionId: "e1", chapterId: "c1", paragraphId: "p1", startOffset: 0, endOffset: 2, selectedText: "承认" };
const data: BookKnowledge = { editionId: "e1", records: [{ id: "r1", editionId: "e1", annotationId: null,
  messageId: "m1", threadId: "t1", createdAt: "2026-09-15T01:00:00Z", summary: "两者独立且统一",
  excerpt: "承认", chapterTitle: "精神", anchor, locationReason: null,
  concepts: [{ name: "承认", text: "主体互相确认" }],
}], concepts: [{ id: "c1", name: "承认", definitions: [{ text: "主体互相确认", recordIds: ["r1"] }],
  recordIds: ["r1"], updatedAt: "2026-09-15T01:00:00Z" }] };

describe("知识数据契约", () => {
  it("严格验证版本、来源关系和锚点", () => {
    expect(isBookKnowledge(data)).toBe(true);
    expect(isBookKnowledge({ ...data, records: [{ ...data.records[0], editionId: "other" }] })).toBe(false);
    expect(isBookKnowledge({ ...data, concepts: [{ ...data.concepts[0], recordIds: ["missing"] }] })).toBe(false);
    expect(isBookKnowledge({ ...data, records: [{ ...data.records[0], anchor: { ...anchor, editionId: "e2" } }] })).toBe(false);
    expect(isKnowledgeAnchor({ ...anchor, endOffset: 100 })).toBe(false);
    expect(isBookKnowledge(null)).toBe(false);
  });

  it.each(["承认", "互相确认", "独立", "精神", "  主体  确认 "])("可按概念、定义、摘要、原文和章节搜索：%s", (query) => {
    expect(filterBookKnowledge(data, query).records).toHaveLength(1);
    expect(filterBookKnowledge(data, query).concepts).toHaveLength(1);
  });

  it("空搜索不过滤，没有结果返回空数组而不更改原数据", () => {
    expect(filterBookKnowledge(data, " ")).toBe(data);
    expect(filterBookKnowledge(data, "不存在")).toMatchObject({ records: [], concepts: [] });
    expect(data.records).toHaveLength(1);
  });

  it("请求仅传 editionId 并禁用缓存，支持取消", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(data)));
    expect(await fetchBookKnowledge("e1", controller.signal, fetcher)).toEqual(data);
    expect(fetcher).toHaveBeenCalledWith("/api/knowledge?editionId=e1", { signal: controller.signal, cache: "no-store" });
  });

  it("拒绝 HTTP 错误、格式错误和跨版本结果", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(fetchBookKnowledge("e1", signal, fetcher)).rejects.toThrow("500");
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(fetchBookKnowledge("e1", signal, fetcher)).rejects.toThrow("数据不完整");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(data)));
    await expect(fetchBookKnowledge("e2", signal, fetcher)).rejects.toThrow("不属于当前书籍");
  });

  it("取消异常原样上抛，交由组件区分主动取消与加载失败", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchBookKnowledge("e1", new AbortController().signal, fetcher)).rejects.toMatchObject({ name: "AbortError" });
  });
});
