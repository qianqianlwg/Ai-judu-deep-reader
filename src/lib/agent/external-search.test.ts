import { describe, expect, it, vi } from "vitest";
import { createExternalSearch, createExternalTools, externalAvailability, readExternalPermissions } from "./external-search";
import type { CrossrefCheck, RegisteredExternalSource } from "./external-reading";
const configured = { OPENALEX_API_KEY: "oa-test", TAVILY_API_KEY: "tavily-test", CROSSREF_MAILTO: "reader@example.org" };
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
describe("外部资料只读连接器", () => {
  it("未授权默认全部关闭；坏授权拒绝；没有密钥时只保留 Crossref", () => {
    expect(readExternalPermissions(undefined)).toEqual({ openalex: false, crossref: false, web: false });
    expect(() => readExternalPermissions({ openalex: true })).toThrow();
    expect(() => readExternalPermissions({ openalex: true, crossref: false, web: false, extra: true })).toThrow();
    expect(externalAvailability({})).toEqual({ openalex: true, crossref: true, web: false });
  });
  it("只装配被授权工具，不上传选文且次数有上限", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.hostname).toBe("api.crossref.org"); expect(url.searchParams.get("query.bibliographic")).toBe("ethics");
      expect(init?.redirect).toBe("error"); return response({ message: { items: [{ title: ["Ethics"], DOI: "10.1234/abc", published: { "date-parts": [[2024]] } }] } });
    });
    const tools = createExternalTools({ permissions: { openalex: false, crossref: true, web: false }, selectedText: "A long selection about reasons and ethics in the source text", signal: new AbortController().signal, search: createExternalSearch(configured, fetcher as typeof fetch) });
    expect(tools.map(tool => tool.name)).toEqual(["verify_crossref"]);
    const run = tools[0].invoke.bind(tools[0]);
    const unsafe = await run({ query: "A long selection about reasons and ethics in the source text" });
    expect(JSON.stringify(unsafe)).toContain("unsafe_query"); expect(fetcher).not.toHaveBeenCalled();
    const found = await run({ query: "ethics" });
    expect(JSON.stringify(found)).toContain("https://doi.org/10.1234/abc");
    await run({ query: "ethics" });
    expect(JSON.stringify(await run({ query: "ethics" }))).toContain("search_limit");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("仅能读取本轮检索注册的来源；打开有 DOI 的 OpenAlex 正文时自动核验 Crossref", async () => {
    const signal = new AbortController().signal;
    const search = vi.fn(async (source: "openalex" | "crossref" | "web", query: string) => source === "openalex" ? { ok: true as const, source, query, evidence: "metadata" as const, durationMs: 1, results: [{ title: "Study", url: "https://openalex.org/W123", readUrl: "https://example.org/oa", doi: "10.1234/abc", evidence: "metadata" as const }] } : { ok: true as const, source, query, evidence: "metadata" as const, durationMs: 1, results: [{ title: "Study", url: "https://doi.org/10.1234/abc", doi: "10.1234/abc", venue: "Philosophy Journal", evidence: "metadata" as const }] });
    const read = vi.fn(async (sourceId: string, entry: RegisteredExternalSource, _signal: AbortSignal, check?: () => Promise<CrossrefCheck>) => ({ ok: true as const, sourceId, source: entry.source, title: entry.result.title, url: entry.readUrl!, text: "已提取的研究正文", evidence: "extracted" as const, coverage: "relevant_chunks" as const, provider: "tavily" as const, durationMs: 1, crossref: await check?.() }));
    const tools = createExternalTools({ permissions: { openalex: true, crossref: true, web: true }, selectedText: "康德第一版序言原文", signal, search, read });
    expect(tools.map(tool => tool.name)).toEqual(["search_openalex", "verify_crossref", "search_web", "read_external_source"]);
    expect(JSON.stringify(await tools[3].invoke({ sourceId: "external:openalex:" + "0".repeat(24) }))).toContain("unknown_source");
    expect(read).not.toHaveBeenCalled();
    const found = await tools[0].invoke({ query: "Kant antinomy" });
    const sourceId = JSON.stringify(found).match(/external:openalex:[a-f0-9]{24}/u)?.[0];
    expect(sourceId).toBeTruthy();
    const opened = await tools[3].invoke({ sourceId: sourceId! });
    expect(JSON.stringify(opened)).toContain("已提取的研究正文");
    expect(JSON.stringify(opened)).toContain("Philosophy Journal");
    expect(search.mock.calls.map(call => call.slice(0, 2))).toEqual([["openalex", "Kant antinomy"], ["crossref", "10.1234/abc"]]);
    expect(read).toHaveBeenCalledOnce();
  });
  it("三路固定域名、查询参数、证据类型正确；不可用不泄漏密钥", async () => {
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.hostname === "api.openalex.org") { expect(url.searchParams.get("api_key")).toBe("oa-test"); return response({ results: [{ display_name: "On meaning", doi: "https://doi.org/10.1000/x", publication_year: 2023 }] }); }
      expect(url.hostname).toBe("api.tavily.com"); expect(init?.method).toBe("POST"); expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer tavily-test");
      expect(JSON.parse(String(init?.body))).toMatchObject({ query: "meaning", search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false });
      return response({ results: [{ title: "Page", url: "https://example.org/p", content: "A snippet" }, { title: "Bad", url: "javascript:alert(1)" }] });
    });
    const search = createExternalSearch(configured, fetcher as typeof fetch), signal = new AbortController().signal;
    const scholarly = await search("openalex", "meaning", signal);
    expect(scholarly).toMatchObject({ ok: true, evidence: "metadata", results: [{ year: 2023, url: "https://doi.org/10.1000/x" }] });
    const web = await search("web", "meaning", signal);
    expect(web).toMatchObject({ ok: true, evidence: "snippet", results: [{ url: "https://example.org/p", snippet: "A snippet" }] });
    if (web.ok) expect(web.results).toHaveLength(1);
    expect(await createExternalSearch({}, fetcher as typeof fetch)("web", "meaning", signal)).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("未配置 Key 时 OpenAlex 不发送 api_key 仍可搜索书目", async () => {
    const fetcher = vi.fn(async (url: URL) => { expect(url.hostname).toBe("api.openalex.org"); expect(url.searchParams.has("api_key")).toBe(false); return response({ results: [{ display_name: "Ethics", id: "https://openalex.org/W123" }] }); });
    const result = await createExternalSearch({}, fetcher as typeof fetch)("openalex", "ethics", new AbortController().signal);
    expect(result).toMatchObject({ ok: true, evidence: "metadata", results: [{ title: "Ethics", url: "https://openalex.org/W123" }] });
  });
  it.each(["10.1234/abc", "DOI 10.1234/abc", "DOI: 10.1234/abc"])("DOI 输入 %s 走精确端点，不走候选书目", async query => {
    const fetcher = vi.fn(async (url: URL) => { expect(url.pathname).toContain("10.1234"); expect(url.searchParams.has("query.bibliographic")).toBe(false); return response({ message: { title: ["An article"], DOI: "10.1234/abc", published: { "date-parts": [[2025]] } } }); });
    const result = await createExternalSearch(configured, fetcher as typeof fetch)("crossref", query, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, matchType: "exact_doi", results: [{ title: "An article", year: 2025 }] });
  });
  it("精确 DOI 的 404 解释为该库未收录，不冒充服务故障或文献不存在", async () => {
    const search = createExternalSearch(configured, vi.fn(async () => new Response("not found", { status: 404 })) as typeof fetch);
    expect(await search("crossref", "DOI 10.1000/182", new AbortController().signal)).toMatchObject({ ok: false, code: "doi_not_found", message: expect.stringContaining("未收录") });
  });
  it("上游故障安全降级，不把失败说成已有证据", async () => {
    const search = createExternalSearch(configured, vi.fn(async () => new Response("rate limit", { status: 429 })) as typeof fetch);
    expect(await search("web", "topic", new AbortController().signal)).toMatchObject({ ok: false, code: "rate_limited" });
  });
});
