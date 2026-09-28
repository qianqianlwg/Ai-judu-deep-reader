import { describe, expect, it, vi } from "vitest";
import { createExternalReader, crossrefCheck, openAlexReadingUrl, openAlexXmlId, publicReadingUrl, type RegisteredExternalSource } from "./external-reading";

const entry: RegisteredExternalSource = { source: "openalex", query: "Kant antinomy", readUrl: "https://example.org/paper", result: { title: "A paper", url: "https://openalex.org/W123", doi: "10.1000/abc", evidence: "metadata" } };
const reply = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
describe("已发现外部来源的受控阅读", () => {
  it("只接受公共 HTTPS，不向外部提取服务发送本地、IP 或带凭证的地址", () => {
    for (const url of ["http://example.org/a", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://x.internal/a", "https://example.org:444/a", "https://user:pass@example.org/a", "file:///etc/passwd"]) expect(publicReadingUrl(url)).toBeUndefined();
    expect(publicReadingUrl("https://example.org/a#local")).toBe("https://example.org/a");
    expect(openAlexReadingUrl({ best_oa_location: { is_oa: false, pdf_url: "https://example.org/a" } })).toBeUndefined();
    expect(openAlexReadingUrl({ best_oa_location: { is_oa: true, pdf_url: "https://example.org/paper.pdf" } })).toBe("https://example.org/paper.pdf");
  });
  it("仅取已登记地址的相关正文片段，原书选文与 AI 回答不外发", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.tavily.com/extract"); expect(init?.redirect).toBe("error");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toEqual({ urls: ["https://example.org/paper"], query: "Kant antinomy", extract_depth: "basic", chunks_per_source: 5, include_images: false });
      return reply({ results: [{ url: "https://example.org/paper", raw_content: "原文片段 Kant argues about reason." }] });
    });
    const reader = createExternalReader({ TAVILY_API_KEY: "test-key" }, fetcher as typeof fetch);
    const result = await reader("external:openalex:" + "a".repeat(24), entry, new AbortController().signal, async () => ({ status: "verified", doi: "10.1000/abc" }));
    expect(result).toMatchObject({ ok: true, evidence: "extracted", coverage: "relevant_chunks", text: "原文片段 Kant argues about reason.", crossref: { status: "verified" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("无开放全文链接和提取空结果均不冒充读过全文", async () => {
    const fetcher = vi.fn(async () => reply({ results: [] }));
    const reader = createExternalReader({ TAVILY_API_KEY: "test-key" }, fetcher as typeof fetch), signal = new AbortController().signal;
    expect(await reader("id", { ...entry, readUrl: undefined }, signal)).toMatchObject({ ok: false, code: "no_open_content" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await reader("id", entry, signal)).toMatchObject({ ok: false, code: "extract_empty" });
    expect(crossrefCheck({ ok: false, source: "crossref", query: "doi", code: "doi_not_found", message: "missing", durationMs: 1 }, "10.1000/abc")).toEqual({ status: "not_found", doi: "10.1000/abc" });
  });
  it("不能信任提取服务返回的其它 URL 或无限长度正文", async () => {
    const fetcher = vi.fn(async () => reply({ results: [{ url: "https://evil.example/other", raw_content: "不相关内容" }, { url: "https://example.org/paper", raw_content: "字".repeat(20000) }] }));
    const result = await createExternalReader({ TAVILY_API_KEY: "test-key" }, fetcher as typeof fetch)("id", entry, new AbortController().signal);
    expect(result.ok && result.text).toHaveLength(6500);
    const unknown = await createExternalReader({ TAVILY_API_KEY: "test-key" }, vi.fn(async () => reply({ results: [{ url: "https://evil.example/other", raw_content: "不相关内容" }] })) as typeof fetch)("id", entry, new AbortController().signal);
    expect(unknown).toMatchObject({ ok: false, code: "extract_empty" });
  });
  it("仅信任 OpenAlex OA 声明及固定内容地址，读取 TEI 正文并跳过参考文献", async () => {
    const work = { id: "https://openalex.org/W2800316506", open_access: { is_oa: true }, has_content: { grobid_xml: true }, content_urls: { grobid_xml: "https://content.openalex.org/works/W2800316506.grobid-xml" } };
    expect(openAlexXmlId(work)).toBe("W2800316506");
    expect(openAlexXmlId({ ...work, content_urls: { grobid_xml: "https://evil.example/works/W2800316506.grobid-xml" } })).toBeUndefined();
    expect(openAlexXmlId({ ...work, open_access: { is_oa: false } })).toBeUndefined();
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.origin + url.pathname).toBe("https://content.openalex.org/works/W2800316506.grobid-xml");
      expect(url.searchParams.get("api_key")).toBe("test-key");
      expect(init?.redirect).toBe("error");
      return new Response('<TEI><text><body><div><p>Kant argues that reason encounters antinomy when it claims to know the unconditioned independently of experience.</p><p>This passage compares rational ideas with the conditions of possible experience and the limits of cognition.</p></div></body><back><listBibl><bibl><p>Unrelated reference entry never to be extracted from the bibliography.</p></bibl></listBibl></back></text></TEI>');
    });
    const reader = createExternalReader({ OPENALEX_API_KEY: "test-key" }, fetcher as typeof fetch);
    const xmlEntry: RegisteredExternalSource = { ...entry, xmlId: "W2800316506" };
    const result = await reader("source", xmlEntry, new AbortController().signal, async () => ({ status: "verified", doi: "10.1000/abc" }), false);
    expect(result).toMatchObject({ ok: true, provider: "openalex_xml", coverage: "selected_passages", crossref: { status: "verified" } });
    expect(result.ok && result.text).toContain("Kant argues");
    expect(result.ok && result.text).not.toContain("Unrelated reference");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("Crossref 故障不导致已读正文失效；未授权网页回退时不调用 Tavily", async () => {
    const fetcher = vi.fn(async () => new Response('<TEI><text><body><p>Long enough primary argument about the critique of reason and the relation to experience.</p></body></text></TEI>'));
    const reader = createExternalReader({ OPENALEX_API_KEY: "test-key", TAVILY_API_KEY: "test-key" }, fetcher as typeof fetch);
    const result = await reader("source", { ...entry, xmlId: "W2800316506" }, new AbortController().signal, async () => { throw new Error("transient"); }, false);
    expect(result).toMatchObject({ ok: true, provider: "openalex_xml", crossref: { status: "unavailable" } });
    expect(await reader("source", entry, new AbortController().signal, undefined, false)).toMatchObject({ ok: false, code: "no_open_content" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
