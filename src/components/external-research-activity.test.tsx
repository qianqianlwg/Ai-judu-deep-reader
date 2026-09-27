// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalResearchActivity } from "./external-research-activity";
import { ExternalPermissionsMenu } from "./external-permissions";
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());
describe("外部检索透明界面", () => {
  it("展开后查看检索词、元数据/摘要、跳转链接，拒绝危险网址", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    await act(async () => root.render(<ExternalResearchActivity message={{ id: "a", role: "assistant", status: "completed", content: "", tools: [{ id: "t", name: "search_web", status: "completed", result: { ok: true, query: "哲学", results: [{ title: "论文", url: "https://example.org/p", evidence: "snippet", snippet: "摘要" }, { title: "恶意", url: "javascript:alert(1)", evidence: "snippet" }] } }] }} />));
    expect(host.textContent).toContain("检索词：哲学"); expect(host.textContent).toContain("书目与搜索片段只是发现线索");
    expect(host.querySelectorAll("a")).toHaveLength(1); expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.org/p");
    await act(async () => root.unmount());
  });
  it("正文阅读独立于检索元数据呈现，预览限定 200 字且核验 DOI 状态透明", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    await act(async () => root.render(<ExternalResearchActivity message={{ id: "a", role: "assistant", status: "completed", content: "已读", tools: [{ id: "s", name: "search_openalex", status: "completed", result: { ok: true, results: [{ title: "文章", url: "https://openalex.org/W123", sourceId: "external:openalex:" + "a".repeat(24), readUrl: "https://example.org/paper", evidence: "metadata" }] } }, { id: "r", name: "read_external_source", status: "completed", result: { ok: true, title: "文章", url: "https://example.org/paper", text: "原".repeat(650), evidence: "extracted", coverage: "relevant_chunks", crossref: { status: "verified", venue: "Journal" }, durationMs: 500 } }] }} />));
    expect(host.textContent).toContain("1 次正文读取"); expect(host.textContent).toContain("有开放正文候选"); expect(host.textContent).toContain("Crossref DOI 核验：已匹配书目记录");
    const preview = host.querySelector<HTMLElement>('[data-source="read_external_source"] summary')!; expect(preview.textContent!.length).toBeLessThan(230);
    expect(host.querySelector('[data-source="read_external_source"]')?.getAttribute("data-evidence")).toBe("extracted");
    await act(async () => root.unmount());
  });
  it("默认不可用来源不可勾选，可用来源变化通过回调", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: { openalex: true, crossref: true, web: false } }), { status: 200 })));
    const host = document.createElement("div"), root = createRoot(host), change = vi.fn();
    await act(async () => root.render(<ExternalPermissionsMenu permissions={{ openalex: false, crossref: false, web: false }} onChange={change} disabled={false} />));
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes[0].disabled).toBe(false); expect(boxes[1].disabled).toBe(false); expect(boxes[2].disabled).toBe(true);
    await act(async () => boxes[1].click()); expect(change).toHaveBeenCalledWith({ openalex: false, crossref: true, web: false });
    await act(async () => root.unmount());
  });
});
