import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createExternalReader, type RegisteredExternalSource } from "./external-reading";
import { createExternalSearch } from "./external-search";

// WHY：外部 API 有网络与额度成本；仅显式设置 RUN_EXTERNAL_SMOKE 才做真实提供商验收。
const live = process.env.RUN_EXTERNAL_SMOKE === "1" ? it : it.skip;
describe("公开外部正文实时冒烟", () => {
  live("OpenAlex OA 解析正文、Tavily 网页文字与 Crossref DOI 分别可读", async () => {
    const file = await readFile(".env.local", "utf8");
    const secret = (key: string) => file.split(/\r?\n/u).find(line => line.startsWith(key + "="))?.slice(key.length + 1).trim().replace(/^['"]|['"]$/gu, "");
    const env = { OPENALEX_API_KEY: secret("OPENALEX_API_KEY"), TAVILY_API_KEY: secret("TAVILY_API_KEY") };
    expect(Boolean(env.OPENALEX_API_KEY && env.TAVILY_API_KEY)).toBe(true);
    const signal = AbortSignal.timeout(40_000);
    const reader = createExternalReader(env);
    const oa: RegisteredExternalSource = { source: "openalex", query: "Kant reason", xmlId: "W2800316506", result: { title: "OpenAlex OA sample", url: "https://openalex.org/W2800316506", evidence: "metadata" } };
    const actual = await reader("external:openalex:" + "a".repeat(24), oa, signal, undefined, false);
    expect(actual).toMatchObject({ ok: true, provider: "openalex_xml" });
    expect(actual.ok && actual.text.length).toBeGreaterThan(50);
    const webpage: RegisteredExternalSource = { source: "web", query: "Kant philosophy", readUrl: "https://plato.stanford.edu/entries/kant/", result: { title: "Kant", url: "https://plato.stanford.edu/entries/kant/", evidence: "snippet" } };
    const extracted = await reader("external:web:" + "b".repeat(24), webpage, signal);
    expect(extracted).toMatchObject({ ok: true, provider: "tavily" });
    expect(extracted.ok && extracted.text.length).toBeGreaterThan(50);
    const crossref = await createExternalSearch(env)("crossref", "10.1038/nphys1170", signal);
    expect(crossref).toMatchObject({ ok: true, matchType: "exact_doi" });
  }, 45_000);
});
