import { describe, expect, it } from "vitest";
import { conversationToolFromRow } from "../conversations";

describe("外部检索历史安全展示", () => {
  it("保留来源、查询词和链接，不下发输入审计或额外字段", () => {
    const saved = conversationToolFromRow({
      id: "x", messageId: "assistant", name: "search_web", status: "completed", inputJson: "secret",
      outputJson: JSON.stringify({ ok: true, source: "web", query: "哲学", results: [{ title: "Page", url: "https://example.org", snippet: "摘要", evidence: "snippet", injected: "hidden" }], durationMs: 12, secret: "hidden" }),
    }, "edition");
    expect(saved?.tool.result).toMatchObject({ query: "哲学", source: "web", results: [{ title: "Page", url: "https://example.org", evidence: "snippet" }] });
    expect(JSON.stringify(saved)).not.toContain("secret");
    expect(JSON.stringify(saved)).not.toContain("injected");
  });
  it("正文片段与 Crossref 状态回放，仅保留允许展示的字段", () => {
    const saved = conversationToolFromRow({ id: "read", messageId: "assistant", name: "read_external_source", status: "completed", outputJson: JSON.stringify({ ok: true, sourceId: "external:web:" + "a".repeat(24), text: "实际页面段落", evidence: "extracted", coverage: "relevant_chunks", title: "网页", url: "https://example.org/a", crossref: { status: "verified", recordType: "journal-article" }, secret: "private" }) }, "edition");
    expect(saved?.tool).toMatchObject({ name: "read_external_source", result: { text: "实际页面段落", crossref: { status: "verified" } } });
    expect(JSON.stringify(saved)).not.toContain("private");
  });
  it("历史 DOI 未收录错误保留可恢复解释但不泄漏上游原始文本", () => {
    const saved = conversationToolFromRow({
      id: "e", messageId: "assistant", name: "verify_crossref", status: "error",
      outputJson: JSON.stringify({ ok: false, code: "doi_not_found", query: "DOI 10.1000/182", message: "private upstream error" }),
    }, "edition");
    expect(saved?.tool.result).toMatchObject({ ok: false, code: "doi_not_found", message: expect.stringContaining("未收录") });
    expect(JSON.stringify(saved)).not.toContain("private upstream error");
  });
});
