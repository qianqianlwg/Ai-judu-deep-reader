import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryBookContent } from "./library";
import { resolveConvertedEpub, verifyConvertedEpub } from "./converted-epub-artifact";
const bytes = new TextEncoder().encode("verified converted EPUB bytes").buffer;
const fileHash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const originalHash = "a".repeat(64);
function book(): LibraryBookContent {
  return { id: "book", title: "书", author: "", editionId: "edition", edition: { id: "edition", fileName: "书.umd", fileType: ".umd", hasOriginalFile: true, originalHash, createdAt: "now", conversion: { format: ".epub", sourceHash: originalHash, fileHash, fileSize: bytes.byteLength, converterVersion: "umd-epub-v1", createdAt: "now" } }, chapters: [{ id: "c", title: "章", sourceHref: "OPS/chapter-0001.xhtml", paragraphs: [{ id: "p", text: "原文" }] }] };
}
afterEach(() => vi.unstubAllGlobals());
describe("UMD转换版渲染身份", () => {
  it("独立下载原UMD与派生EPUB且身份不被覆盖", () => {
    const value = book(); const state = resolveConvertedEpub(value);
    expect(state.kind).toBe("ready"); if (state.kind !== "ready") throw new Error("not ready");
    expect(state.artifact.url).toBe("/api/books/book/converted?editionId=edition");
    expect(state.artifact.originalUrl).toBe("/api/books/book/original?editionId=edition");
    expect(state.artifact.conversion).toEqual(value.edition!.conversion);
    expect(value.edition!.originalHash).toBe(originalHash);
  });
  it("编码书籍和版本标识，不能从文件名拼磁盘或网络地址", () => {
    const value = book(); value.id = "book/a?x"; value.editionId = "e/&"; value.edition!.id = value.editionId;
    const state = resolveConvertedEpub(value); expect(state.kind).toBe("ready");
    if (state.kind === "ready") expect(state.artifact.url).toBe("/api/books/book%2Fa%3Fx/converted?editionId=e%2F%26");
  });
  it.each([".epub", ".pdf", ".fb2", ".cbz", ".mobi", ".txt"])("%s不会被伪装成UMD转换版", format => {
    const value = book(); value.edition!.fileType = format; expect(resolveConvertedEpub(value)).toEqual({ kind: "none" });
  });
  it.each(["edition", "missing", "original", "source", "target", "version", "href", "empty"])("%s损坏明确拒绝而非回退原件", field => {
    const value = book();
    if (field === "edition") value.edition!.id = "other";
    if (field === "missing") delete value.edition!.conversion;
    if (field === "original") value.edition!.hasOriginalFile = false;
    if (field === "source") value.edition!.conversion!.sourceHash = "b".repeat(64);
    if (field === "target") value.edition!.conversion!.fileHash = "bad";
    if (field === "version") Object.assign(value.edition!.conversion!, { converterVersion: "unverified" });
    if (field === "href") value.chapters[0].sourceHref = "../chapter.xhtml";
    if (field === "empty") value.chapters[0].paragraphs = [];
    expect(resolveConvertedEpub(value)).toMatchObject({ kind: "invalid", message: expect.any(String) });
  });
  it("派生字节精确校验，大小相同但hash不同也不放行", async () => {
    vi.stubGlobal("crypto", webcrypto); const state = resolveConvertedEpub(book()); if (state.kind !== "ready") throw new Error("not ready");
    await expect(verifyConvertedEpub(bytes, state.artifact)).resolves.toBeUndefined();
    const corrupt = bytes.slice(0); new Uint8Array(corrupt)[0] ^= 1;
    await expect(verifyConvertedEpub(corrupt, state.artifact)).rejects.toThrow("内容与版本记录不一致");
    await expect(verifyConvertedEpub(bytes.slice(1), state.artifact)).rejects.toThrow("大小与版本记录不一致");
    vi.stubGlobal("crypto", undefined); await expect(verifyConvertedEpub(bytes, state.artifact)).rejects.toThrow("完整性校验");
  });
});
