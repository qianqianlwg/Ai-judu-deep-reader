import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { isRecord } from "../chat-stream";
import type { ExternalResult, ExternalResponse } from "./external-search";

export type RegisteredExternalSource = { source: "openalex" | "web"; query: string; result: ExternalResult; readUrl?: string; xmlId?: string };
export type CrossrefCheck = { status: "verified" | "not_found" | "unavailable" | "not_authorized"; doi?: string; title?: string; venue?: string; recordType?: string };
export type ExternalReading =
  | { ok: true; sourceId: string; source: "openalex" | "web"; title: string; url: string; text: string; evidence: "extracted"; coverage: "relevant_chunks" | "selected_passages"; provider: "tavily" | "openalex_xml"; crossref?: CrossrefCheck; durationMs: number }
  | { ok: false; sourceId: string; code: string; message: string; durationMs?: number; crossref?: CrossrefCheck };

// WHY：Tavily 将代用户抓取已检索的公开网页，拒绝内网、非 HTTPS、IP 和带端口 URL，不能让模型提供任意抓取目标。
export function publicReadingUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/gu, "")) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(host)) return;
    if (/\.(?:onion|lan)$/iu.test(host)) return;
    url.hash = "";
    return url.href;
  } catch { return; }
}
async function limitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 750_000) throw new Error("response_too_large"); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => undefined); }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(all);
}
function limitedJson(response: Response): Promise<unknown> { return limitedBody(response).then(text => JSON.parse(text) as unknown); }
export function openAlexXmlId(work: Record<string, unknown>): string | undefined {
  const id = typeof work.id === "string" ? /^https:\/\/openalex\.org\/(W\d+)$/u.exec(work.id)?.[1] : undefined;
  if (!id || !isRecord(work.has_content) || work.has_content.grobid_xml !== true || !isRecord(work.open_access) || work.open_access.is_oa !== true || !isRecord(work.content_urls)) return;
  const url = publicReadingUrl(work.content_urls.grobid_xml);
  return url === "https://content.openalex.org/works/" + id + ".grobid-xml" ? id : undefined;
}
export function openAlexReadingUrl(work: Record<string, unknown>): string | undefined {
  const location = isRecord(work.best_oa_location) ? work.best_oa_location : undefined;
  if (!location || location.is_oa !== true) return;
  // WHY：优先 HTML 落地页；通用网页提取器处理 PDF 的成功率和内容覆盖不稳定。
  return publicReadingUrl(location.landing_page_url) ?? publicReadingUrl(location.pdf_url);
}
function extractedParagraphs(xml: string, query: string): string {
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: false, parseTagValue: false });
  const document: unknown = parser.parse(xml);
  const body = isRecord(document) && isRecord(document.TEI) && isRecord(document.TEI.text) ? document.TEI.text.body : undefined;
  if (!body) return "";
  const plain = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(plain).join(" ");
    if (!isRecord(node)) return "";
    return Object.values(node).map(plain).join(" ");
  };
  const paragraphs: string[] = [];
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 16 || !node) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
    if (!isRecord(node)) return;
    for (const [name, value] of Object.entries(node)) {
      if (name === "p") {
        const parts = Array.isArray(value) ? value : [value];
        for (const part of parts) { const text = plain(part).replace(/\s+/gu, " ").trim(); if (text.length > 45) paragraphs.push(text); }
      } else if (!["figure", "table", "note", "ref", "listBibl"].includes(name)) visit(value, depth + 1);
    }
  };
  visit(body);
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).slice(0, 8))];
  const ranked = paragraphs.map((text, index) => ({ index, text, score: terms.reduce((sum, term) => sum + (text.toLowerCase().includes(term) ? 1 : 0), 0) }));
  const selected = ranked.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8).sort((a, b) => a.index - b.index);
  return selected.map(item => item.text).join("\n\n").slice(0, 6500);
}

export function createExternalReader(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  return async (sourceId: string, entry: RegisteredExternalSource, signal: AbortSignal, checkCrossref?: () => Promise<CrossrefCheck>, allowWeb = true): Promise<ExternalReading> => {
    const started = Date.now();
    const publicUrl = publicReadingUrl(entry.readUrl);
    if (!publicUrl && !entry.xmlId) return { ok: false, sourceId, code: "no_open_content", message: "此条目未发现可安全读取的公开正文地址；仅能核对书目" };
    // WHY：仅凭 OpenAlex 的可验证作品 ID 在固定域名取已标记 OA 的机器解析正文，不访问模型提供的 URL。
    if (entry.source === "openalex" && entry.xmlId && env.OPENALEX_API_KEY?.trim()) {
      try {
        const url = new URL("https://content.openalex.org/works/" + entry.xmlId + ".grobid-xml");
        url.searchParams.set("api_key", env.OPENALEX_API_KEY.trim());
        const xml = await fetcher(url, { headers: { Accept: "application/xml" }, signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]), redirect: "error", cache: "no-store" });
        if (xml.ok) {
          const text = extractedParagraphs(await limitedBody(xml), entry.query);
          if (text) {
            // WHY：DOI 核验是附加元数据，不能因其故障丢弃已成功取得的正文。
            const crossref = await safeCrossref(checkCrossref);
            return { ok: true, sourceId, source: entry.source, title: entry.result.title, url: "https://openalex.org/" + entry.xmlId, text, evidence: "extracted", coverage: "selected_passages", provider: "openalex_xml", ...(crossref ? { crossref } : {}), durationMs: Date.now() - started };
          }
        }
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        console.warn("OpenAlex 解析正文读取失败", { reason: error instanceof Error ? error.name : "unknown" });
      }
    }
    if (!allowWeb) return { ok: false, sourceId, code: "no_open_content", message: "未取得 OpenAlex 解析正文；网页提取未授权，不能读取其它来源", durationMs: Date.now() - started };
    if (!env.TAVILY_API_KEY?.trim()) return { ok: false, sourceId, code: "not_configured", message: "网页提取未配置", durationMs: Date.now() - started };
    if (!publicUrl) return { ok: false, sourceId, code: "no_open_content", message: "没有可安全读取的公开链接", durationMs: Date.now() - started };
    try {
      signal.throwIfAborted();
      // WHY：仅发送已登记的公开 URL 与简短检索词，禁用自动回答和图片，相关片段并非整篇文章。
      const responsePromise = fetcher("https://api.tavily.com/extract", { method: "POST", headers: { Authorization: "Bearer " + env.TAVILY_API_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ urls: [publicUrl], query: entry.query, extract_depth: "basic", chunks_per_source: 5, include_images: false }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]), redirect: "error", cache: "no-store" });
      // WHY：Crossref 仅在获授权且读取有 DOI 的 OpenAlex 候选时并行核对，失败不把提取成功伪装为正文失败。
      const [response, crossref] = await Promise.all([responsePromise, safeCrossref(checkCrossref)]);
      if (!response.ok) return { ok: false, sourceId, code: response.status === 429 ? "rate_limited" : "extract_failed", message: "网页提取未取得可用内容", durationMs: Date.now() - started, ...(crossref ? { crossref } : {}) };
      const payload = await limitedJson(response);
      if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("invalid_extract_response");
      const match = payload.results.find(item => isRecord(item) && publicReadingUrl(item.url) === publicUrl);
      const text = isRecord(match) && typeof match.raw_content === "string" ? match.raw_content.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 6500) : "";
      if (!text) return { ok: false, sourceId, code: "extract_empty", message: "页面没有返回可核读文字；不能推断文献不存在或不可访问", durationMs: Date.now() - started, ...(crossref ? { crossref } : {}) };
      return { ok: true, sourceId, source: entry.source, title: entry.result.title, url: publicUrl, text, evidence: "extracted", coverage: "relevant_chunks", provider: "tavily", ...(crossref ? { crossref } : {}), durationMs: Date.now() - started };
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      console.warn("外部页面提取失败", { source: entry.source, reason: error instanceof Error ? error.name : "unknown" });
      return { ok: false, sourceId, code: "extract_failed", message: "页面提取超时或响应异常，未获得可核读文字", durationMs: Date.now() - started };
    }
  };
}
async function safeCrossref(check?: () => Promise<CrossrefCheck>): Promise<CrossrefCheck | undefined> {
  try { return await check?.(); }
  catch (error: unknown) {
    console.warn("Crossref 附加核验失败", { reason: error instanceof Error ? error.name : "unknown" });
    return { status: "unavailable" };
  }
}
export function crossrefCheck(result: ExternalResponse, doi: string): CrossrefCheck {
  if (!result.ok) return { status: result.code === "doi_not_found" ? "not_found" : "unavailable", doi };
  const matched = result.results.find(item => item.doi?.toLowerCase() === doi.toLowerCase());
  return matched ? { status: "verified", doi, title: matched.title, ...(matched.venue ? { venue: matched.venue } : {}), ...(matched.recordType ? { recordType: matched.recordType } : {}) } : { status: "unavailable", doi };
}
