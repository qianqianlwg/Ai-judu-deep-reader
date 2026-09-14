import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBookKnowledge } from "./knowledge-records";
import { hashText } from "./hash";

const source = { edition_id: "e1", source_edition_id: "e1", paragraph_id: "p1",
  paragraph_text: "甲自我意识乙", chapter_id: "c1", chapter_title: "自我意识" };
const anchor = { paragraphId: "p1", startOffset: 1, endOffset: 5, selectedText: "自我意识" };
const analysis = { summary: "自我意识的承认关系", breakdown: [],
  concepts: [{ name: "自我意识", text: "主体对自身的意识。" }], context: "", uncertainty: "" };
const message = (id = "m1", extra: Record<string, unknown> = {}) => ({ ...source, id, thread_id: "t1",
  role: "assistant", status: "completed", created_at: "2026-09-15T01:00:00Z",
  structured_output: JSON.stringify({ ...analysis, anchor }), ...extra });
const annotation = (extra: Record<string, unknown> = {}) => ({ ...source, id: "a1", thread_id: "t1",
  summary: analysis.summary, concepts: '["自我意识"]', concept_details: "[]",
  start_offset: 1, end_offset: 5, text_hash: hashText("自我意识"), stored_message_id: null,
  message_id: null, created_at: "2026-09-15T01:01:00Z", ...extra });

afterEach(() => vi.restoreAllMocks());

describe("本书知识聚合", () => {
  it("读取所有会话并保留逐次记录，而不是只看最新线程", () => {
    const data = buildBookKnowledge("e1", [], [message(), message("m2", { thread_id: "t2" })]);
    expect(data.records.map((item) => item.threadId)).toEqual(["t1", "t2"]);
    expect(data.concepts[0].recordIds).toHaveLength(2);
    expect(data.concepts[0].definitions[0].recordIds).toHaveLength(2);
    expect(data.records[0].anchor).toEqual({ ...anchor, editionId: "e1", chapterId: "c1" });
  });

  it("普通聊天、失败、流式未完成、用户消息及其他版本不列入句读", () => {
    const rows = [message("chat", { structured_output: null }), message("error", { status: "error" }),
      message("pending", { status: "streaming" }), message("user", { role: "user" }),
      message("other", { edition_id: "e2" }),
      message("chat-json", { structured_output: JSON.stringify({ ...analysis, mode: "chat" }) }),
      message("not-analysis", { structured_output: '{"summary":"只是聊天"}' })];
    expect(buildBookKnowledge("e1", [], rows).records).toEqual([]);
  });

  it("旧消息不使用线程选文、引用或相同文本猜测锚点", () => {
    const data = buildBookKnowledge("e1", [], [message("old", { selected_text: "自我意识",
      selection_start: 1, selection_end: 5,
      structured_output: JSON.stringify({ ...analysis, citations: [{ paragraphId: "p1", quote: "自我意识" }] }) })]);
    expect(data.records[0]).toMatchObject({ anchor: null, excerpt: "", messageId: "old", threadId: "t1" });
    expect(data.records[0].locationReason).toContain("未保存准确");
  });

  it.each([
    { ...anchor, startOffset: 0 }, { ...anchor, endOffset: 50 },
    { ...anchor, startOffset: 1.5 }, { ...anchor, paragraphId: "another" },
    { ...anchor, selectedText: "伪造选文" },
  ])("拒绝不准确的消息锚点 %j", (invalid) => {
    const data = buildBookKnowledge("e1", [], [message("bad", {
      structured_output: JSON.stringify({ ...analysis, anchor: invalid }),
    })]);
    expect(data.records[0].anchor).toBeNull();
    expect(data.records[0].locationReason).toContain("不一致");
  });

  it("不允许来源段落跨版本", () => {
    expect(buildBookKnowledge("e1", [], [message("bad", { source_edition_id: "e2" })]).records[0].anchor).toBeNull();
    expect(buildBookKnowledge("e1", [annotation({ edition_id: "e2" })], []).records).toEqual([]);
  });

  it("显式 messageId 合并标注与消息，补全旧消息的已验证锚点", () => {
    const data = buildBookKnowledge("e1", [annotation({ stored_message_id: "m1", message_id: "m1",
      concept_details: JSON.stringify([{ name: "承认", text: "彼此确认。" }]) })],
    [message("m1", { structured_output: JSON.stringify(analysis) })]);
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({ annotationId: "a1", messageId: "m1", anchor });
    expect(data.concepts.map((concept) => concept.name)).toEqual(["自我意识", "承认"]);
  });

  it("没有显式消息关联时保留旧标注，但不推测消息 ID", () => {
    const data = buildBookKnowledge("e1", [annotation()], [message()]);
    expect(data.records).toHaveLength(2);
    expect(data.records[0]).toMatchObject({ annotationId: "a1", messageId: null, anchor });
  });

  it("标注哈希失配时不冒充原文，不允许跳转", () => {
    const data = buildBookKnowledge("e1", [annotation({ text_hash: "outdated" })], []);
    expect(data.records[0]).toMatchObject({ excerpt: "", anchor: null });
  });

  it("新概念详情优先于旧概念名，但不同来源的定义不被覆盖", () => {
    const data = buildBookKnowledge("e1", [annotation({
      concept_details: JSON.stringify([{ name: "自我意识", text: "另一种有出处的解释。" }]),
    })], [message()]);
    expect(data.concepts[0].definitions).toHaveLength(2);
    expect(data.records[0].concepts).toEqual([{ name: "自我意识", text: "另一种有出处的解释。" }]);
  });

  it("无定义的旧关键词不编造释义", () => {
    const data = buildBookKnowledge("e1", [annotation({ thread_id: null })], []);
    expect(data.concepts[0].definitions).toEqual([]);
    expect(data.records[0].threadId).toBeNull();
  });

  it("损坏 JSON 记录被记录日志，不拖垮其他有效记录", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = buildBookKnowledge("e1", [annotation({ concept_details: "{" })], [message("broken", { structured_output: "{" }), message()]);
    expect(data.records).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("不把链接到普通聊天、失败消息或另一个线程的标注列入句读", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(buildBookKnowledge("e1", [annotation({ stored_message_id: "chat", message_id: "chat" })],
      [message("chat", { structured_output: null })]).records).toEqual([]);
    const data = buildBookKnowledge("e1", [annotation({ stored_message_id: "m1", message_id: "m1", thread_id: "t2" })], [message()]);
    expect(data.records[0].annotationId).toBeNull();
  });
});
