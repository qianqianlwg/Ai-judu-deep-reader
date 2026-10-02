import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { isRecord } from "../chat-stream";
import type { ExternalResult, ExternalResponse } from "./external-search";

export type RegisteredExternalSource = { source: "openalex" | "web"; query: string; result: ExternalResult; readUrl?: string; readUrls?: string[]; xmlId?: string };
export type CrossrefCheck = { status: "verified" | "not_found" | "unavailable" | "not_authorized"; doi?: string; title?: string; venue?: string; recordType?: string };
export type ReadingAttempt = { url: string; code: string; message: string };
export type ExternalReading =
  | { ok: true; sourceId: string; source: "openalex" | "web"; title: string; url: string; text: string; evidence: "extracted"; coverage: "relevant_chunks" | "selected_passages"; provider: "tavily" | "openalex_xml"; crossref?: CrossrefCheck; durationMs: number; attempts?: ReadingAttempt[] }
  | { ok: false; sourceId: string; code: string; message: string; durationMs?: number; crossref?: CrossrefCheck; attempts?: ReadingAttempt[] };

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
export function openAlexReadingUrls(work: Record<string, unknown>): string[] {
  // WHY：仅使用来源明确标记 OA 的已发现位置，保留落地页、PDF 和仓储版本供回退，不绕过访问权限。
  const locations = [work.best_oa_location, ...(Array.isArray(work.locations) ? work.locations : [])];
  const urls = new Set<string>();
  for (const location of locations) {
    if (!isRecord(location) || location.is_oa !== true) continue;
    for (const value of [location.landing_page_url, location.pdf_url]) {
      const url = publicReadingUrl(value); if (url) urls.add(url);
    }
  }
  return [...urls].slice(0, 3);
}
export function openAlexReadingUrl(work: Record<string, unknown>): string | undefined { return openAlexReadingUrls(work)[0]; }
function extractedParagraphs(xml: string): string {
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: false, parseTagValue: false });
  const document: unknown = parser.parse(xml);
  const root = isRecord(document) ? document.TEI ?? document.tei : undefined;
  const text = isRecord(root) && isRecord(root.text) ? root.text : undefined;
  const body = text?.body ?? text?.div;
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
  // WHY：仅按原文顺序返回有界片段，相关性判断由 Agent 完成，不使用本地关键词打分。
  return paragraphs.join("\n\n").slice(0, 6500);
}

export function createExternalReader(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  return async (sourceId: string, entry: RegisteredExternalSource, signal: AbortSignal, checkCrossref?: () => Promise<CrossrefCheck>, allowWeb = true): Promise<ExternalReading> => {
    const started = Date.now();
    const urls = [...new Set([entry.readUrl, ...(entry.readUrls ?? [])].map(publicReadingUrl).filter((url): url is string => Boolean(url)))].slice(0, 3);
    const attempts: ReadingAttempt[] = [];
    const failure = (code: string, message: string, crossref?: CrossrefCheck): ExternalReading => ({ ok: false, sourceId, code, message, attempts, durationMs: Date.now() - started, ...(crossref ? { crossref } : {}) });
    signal.throwIfAborted();
    if (!urls.length && !entry.xmlId) return failure("no_open_content", "未识别公开正文入口；不代表没有公开版本");
    // WHY：只在固定内容域名读取经 OA 校验的作品，不使用模型自行提供的正文地址。
    if (entry.source === "openalex" && entry.xmlId) {
      const address = "https://content.openalex.org/works/" + entry.xmlId + ".grobid-xml";
      if (!env.OPENALEX_API_KEY?.trim()) attempts.push({ url: address, code: "not_configured", message: "OpenAlex 解析正文需要配置 API Key" });
      else try {
        const url = new URL(address); url.searchParams.set("api_key", env.OPENALEX_API_KEY.trim());
        const response = await fetcher(url, { headers: { Accept: "application/xml" }, signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]), redirect: "error", cache: "no-store" });
        const text = response.ok ? extractedParagraphs(await limitedBody(response)) : "";
        if (text) {
          const crossref = await safeCrossref(checkCrossref);
          return { ok: true, sourceId, source: entry.source, title: entry.result.title, url: "https://openalex.org/" + entry.xmlId, text, evidence: "extracted", coverage: "selected_passages", provider: "openalex_xml", attempts, ...(crossref ? { crossref } : {}), durationMs: Date.now() - started };
        }
        attempts.push({ url: address, code: response.ok ? "xml_empty" : "xml_http", message: response.ok ? "XML 未识别到正文段落" : "OpenAlex 正文响应 HTTP " + response.status });
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        console.warn("OpenAlex 解析正文读取失败", { reason: error instanceof Error ? error.name : "unknown" });
        attempts.push({ url: address, code: "xml_failed", message: error instanceof Error && error.message === "response_too_large" ? "XML 响应超过大小上限" : "XML 读取超时或解析异常" });
      }
    }
    if (!allowWeb) return failure("no_open_content", "未取得 OpenAlex 解析正文；网页提取未授权，不能读取其他来源");
    if (!urls.length) return failure("no_open_content", "未取得解析正文，也未识别其他安全公开入口");
    if (!env.TAVILY_API_KEY?.trim()) return failure("not_configured", "网页提取未配置");
    // WHY：DOI 核验只执行一次，失败不能使正文失效；每条来源最多回退三个已登记公开入口。
    const crossrefPromise = safeCrossref(checkCrossref);
    for (const publicUrl of urls) {
      try {
        signal.throwIfAborted();
        const response = await fetcher("https://api.tavily.com/extract", { method: "POST", headers: { Authorization: "Bearer " + env.TAVILY_API_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ urls: [publicUrl], query: entry.query, extract_depth: "basic", chunks_per_source: 5, include_images: false }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]), redirect: "error", cache: "no-store" });
        if (!response.ok) {
          attempts.push({ url: publicUrl, code: response.status === 429 ? "rate_limited" : "extract_failed", message: "网页提取服务响应 HTTP " + response.status });
          if ([401, 403, 429].includes(response.status)) break;
          continue;
        }
        const payload = await limitedJson(response);
        if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("invalid_extract_response");
        const match = payload.results.find(item => isRecord(item) && publicReadingUrl(item.url) === publicUrl);
        const text = isRecord(match) && typeof match.raw_content === "string" ? match.raw_content.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 6500) : "";
        if (!text) {
          const failed = Array.isArray(payload.failed_results) ? payload.failed_results.find(item => isRecord(item) && publicReadingUrl(item.url) === publicUrl) : undefined;
          // WHY：只反馈已登记 URL 的有界错误信息，不把外部错误作为正文或指令。
          attempts.push({ url: publicUrl, code: "extract_empty", message: isRecord(failed) && typeof failed.error === "string" ? failed.error.replace(/<[^>]*>/gu, " ").slice(0, 240) : "页面没有返回可核读文字" });
          continue;
        }
        const crossref = await crossrefPromise;
        return { ok: true, sourceId, source: entry.source, title: entry.result.title, url: publicUrl, text, evidence: "extracted", coverage: "relevant_chunks", provider: "tavily", attempts, ...(crossref ? { crossref } : {}), durationMs: Date.now() - started };
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        console.warn("外部页面提取失败", { source: entry.source, reason: error instanceof Error ? error.name : "unknown" });
        attempts.push({ url: publicUrl, code: "extract_failed", message: error instanceof Error && error.message === "response_too_large" ? "提取响应超过大小上限" : "页面提取超时或响应异常" });
      }
    }
    return failure(attempts.at(-1)?.code ?? "extract_failed", "已尝试公开入口，未取得可核读文字；不代表文献不存在或没有公开版本", await crossrefPromise);
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
