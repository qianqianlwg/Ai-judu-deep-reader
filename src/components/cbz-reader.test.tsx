// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CbzReader, type CbzReaderProps } from "./cbz-reader";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import type { LibraryBookContent } from "@/lib/library";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function image(width: number, height: number): Promise<Buffer> { return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 40, b: 180 } } }).png().toBuffer(); }
const hashA = "a".repeat(64), hashB = "b".repeat(64);
function book(editionId = "e", originalHash = hashA): LibraryBookContent { return { id: "book", title: "测试漫画", author: "作者", editionId, edition: { id: editionId, fileName: "测试.cbz", fileType: "cbz", hasOriginalFile: true, originalHash, createdAt: "2026-09-18" }, chapters: [1, 2, 3].map(page => ({ id: `c${page}`, title: `第 ${page} 页`, sourceHref: `cbz-v1/${page}.png`, paragraphs: [] })) }; }
function response(bytes: Buffer, width: number, height: number, status = 200, mime = "image/png"): Response { const headers = new Headers({ "content-type": mime, "content-length": String(bytes.length), "x-judu-image-width": String(width), "x-judu-image-height": String(height) }); return { ok: status >= 200 && status < 300, status, headers, blob: async () => new Blob([new Uint8Array(bytes)], { type: mime }), json: async () => ({ error: "受控错误" }) } as unknown as Response; }
let root: Root, host: HTMLDivElement, props: CbzReaderProps, currentBook: LibraryBookContent, pageBytes: Buffer[], urls: Map<string, Blob>, revoked: string[];
const dialog = () => host.querySelector<HTMLElement>("[role=alert]");
const pageInput = () => host.querySelector<HTMLInputElement>('[aria-label="CBZ页码"]')!;
const viewport = () => host.querySelector<HTMLDivElement>(".cbz-viewport")!;
const imageNode = () => host.querySelector<HTMLImageElement>("img");
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
async function render(next: Partial<CbzReaderProps> = {}) { props = { ...props, ...next }; await act(async () => root.render(<CbzReader {...props} />)); }
async function waitImage() { await vi.waitFor(() => expect(imageNode()).not.toBeNull()); }
async function change(selector: string, value: string) { const element = host.querySelector<HTMLSelectElement | HTMLInputElement>(selector)!; await act(async () => { const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function key(value: string) { const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }); await act(async () => viewport().dispatchEvent(event)); return event; }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); urls = new Map(); revoked = []; pageBytes = [await image(80, 60), await image(120, 90), await image(160, 120)];
  let sequence = 0; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { const url = `blob:cbz-test-${++sequence}`; urls.set(url, blob); return url; }) }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((url: string) => { revoked.push(url); }) });
  vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  currentBook = book(); const fetchMock = vi.fn(async (input: RequestInfo | URL) => { const url = String(input), page = Number(new URL(url, "http://local").searchParams.get("page")); return response(pageBytes[page - 1], pageBytes[page - 1] ? [80, 120, 160][page - 1] : 0, pageBytes[page - 1] ? [60, 90, 120][page - 1] : 0); }); vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { book: currentBook, anchor: null, appearance: DEFAULT_READING_APPEARANCE, annotations: [], concepts: [], onSelect: vi.fn(), onPosition: vi.fn(), onNotice: vi.fn(), onFallback: vi.fn(), onClearSelection: vi.fn(), onStartSelection: vi.fn(), onImagePage: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("CBZ图片原版阅读器", () => {
  it("按版本和页码请求图片，展示真实尺寸并明确没有文字句读", async () => {
    await render(); await waitImage(); expect(fetch).toHaveBeenCalledWith("/api/books/book/image?editionId=e&page=1", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(imageNode()?.src).toContain("blob:cbz-test-1"); expect(imageNode()?.alt).toBe("第 1 页"); expect(imageNode()?.style.width).toBeTruthy(); expect(host.textContent).toContain("OCR 尚未启用"); expect(host.textContent).toContain("不能选择文字句读");
    expect(host.querySelector(".textLayer,textarea")).toBeNull(); expect(props.onImagePage).toHaveBeenCalledWith(1);
  });
  it("上一页/下一页和PageDown切换页码，旧blob撤销且清理选区", async () => {
    await render(); await waitImage(); const firstUrl = imageNode()!.src; vi.mocked(props.onClearSelection!).mockClear();
    await act(async () => button("下一页").click()); await vi.waitFor(() => expect(pageInput().value).toBe("2")); await waitImage();
    expect(fetch).toHaveBeenCalledWith("/api/books/book/image?editionId=e&page=2", expect.anything()); expect(revoked).toContain(firstUrl); expect(props.onClearSelection).toHaveBeenCalled();
    const event = await key("PageDown"); expect(event.defaultPrevented).toBe(true); await vi.waitFor(() => expect(pageInput().value).toBe("3"));
    await act(async () => button("上一页").click()); await vi.waitFor(() => expect(pageInput().value).toBe("2"));
  });
  it("LTR/RTL方向键语义相反，Home/End遵守页码边界", async () => {
    await render(); await waitImage(); const right = await key("ArrowRight"); expect(right.defaultPrevented).toBe(true); await vi.waitFor(() => expect(pageInput().value).toBe("2"));
    await change('[aria-label="CBZ阅读方向"]', "rtl"); const left = await key("ArrowLeft"); expect(left.defaultPrevented).toBe(true); await vi.waitFor(() => expect(pageInput().value).toBe("3"));
    await key("Home"); await vi.waitFor(() => expect(pageInput().value).toBe("1")); await key("End"); await vi.waitFor(() => expect(pageInput().value).toBe("3"));
  });
  it("缩放和适应方式只改变视觉布局与位置存储，不重新请求同一页", async () => {
    await render(); await waitImage(); const beforeCalls = vi.mocked(fetch).mock.calls.length, beforeWidth = imageNode()!.style.width;
    await change('[aria-label="CBZ缩放"]', "200"); await change('[aria-label="CBZ适应方式"]', "width"); await change('[aria-label="CBZ阅读方向"]', "rtl");
    expect(vi.mocked(fetch).mock.calls.length).toBe(beforeCalls); expect(imageNode()!.style.width).not.toBe(beforeWidth);
    expect(JSON.parse(localStorage.getItem("judu:cbz-position:e")!)).toMatchObject({ originalHash: hashA, page: 1, zoom: 200, fit: "width", direction: "rtl" });
  });
  it("同hash恢复页码和视觉设置，坏JSON由阅读器降级并提示而不阻断原版", async () => {
    localStorage.setItem("judu:cbz-position:e", JSON.stringify({ version: 1, originalHash: hashA, page: 2, zoom: 150, fit: "page", direction: "ltr" })); await render(); await waitImage();
    expect(pageInput().value).toBe("2"); expect(host.querySelector<HTMLSelectElement>('[aria-label="CBZ缩放"]')?.value).toBe("150");
    await act(async () => root.unmount()); host.innerHTML = ""; root = createRoot(host); localStorage.setItem("judu:cbz-position:e", "{bad"); await act(async () => root.render(<CbzReader {...props} />));
    await vi.waitFor(() => expect(pageInput().value).toBe("1")); expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置无法恢复"));
  });
  it("hash不一致、版本切换和旧响应不能污染新书位置或图片", async () => {
    localStorage.setItem("judu:cbz-position:e", JSON.stringify({ version: 1, originalHash: hashB, page: 3, zoom: 200, fit: "width", direction: "rtl" })); await render(); await waitImage(); expect(pageInput().value).toBe("1");
    const oldUrl = imageNode()!.src; const next = book("e2", hashB); await render({ book: next }); await waitImage(); expect(revoked).toContain(oldUrl); expect(fetch).toHaveBeenLastCalledWith("/api/books/book/image?editionId=e2&page=1", expect.anything());
  });
  it("请求返回不支持MIME或HTTP错误显示可恢复提示，重试可重新读取", async () => {
    const fetchMock = vi.mocked(fetch); fetchMock.mockReset().mockResolvedValueOnce(response(pageBytes[0], 80, 60, 415, "application/json")).mockResolvedValueOnce(response(pageBytes[0], 80, 60));
    await render(); await vi.waitFor(() => expect(dialog()).not.toBeNull()); expect(dialog()?.textContent).toContain("受控错误");
    await act(async () => dialog()!.querySelector("button")!.click()); await waitImage(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("卸载期间中止fetch，迟到响应不会创建图片blob或错误UI", async () => {
    const pending = deferred<Response>(), fetchMock = vi.mocked(fetch); fetchMock.mockReset().mockReturnValueOnce(pending.promise);
    await render(); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled()); const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal; await act(async () => root.unmount());
    expect(signal.aborted).toBe(true); pending.resolve(response(pageBytes[0], 80, 60)); await act(async () => Promise.resolve()); expect(host.querySelector("img")).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
    root = createRoot(host);
  });
  it("外部图片页请求只接受受控尺寸与MIME，不把服务响应当任意HTML", async () => {
    const fetchMock = vi.mocked(fetch); fetchMock.mockReset().mockResolvedValue(response(Buffer.from("<script>bad()</script>"), 1, 1, 200, "text/html")); await render();
    await vi.waitFor(() => expect(dialog()).not.toBeNull()); expect(dialog()?.textContent).toContain("响应类型不受支持"); expect(host.querySelector("script")).toBeNull();
  });
});



