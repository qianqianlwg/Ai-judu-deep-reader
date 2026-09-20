import { describe, expect, it } from "vitest";
import { bookEditionUrl, readBookResponse, readLibraryResponse, rememberedEdition } from "./library";
const old = { id: "old", fileName: "旧译.epub", fileType: "epub", createdAt: "2025-01-01" };
const latest = { id: "new", fileName: "新译.pdf", fileType: "pdf", createdAt: "2026-01-01" };
const book = { id: "a", title: "同名书", author: "作者", editions: [latest, old] };
describe("书籍版本身份", () => {
  it("同标题不同BookID以及同Book多个EditionID均保留", () => {
    const result = readLibraryResponse([book, { id: "b", title: "同名书", author: "作者", editions: [{ ...old, id: "b-old" }] }]);
    expect(result.map(item => item.id)).toEqual(["a", "b"]); expect(result[0].editions?.map(item => item.id)).toEqual(["new", "old"]);
  });
  it("重复身份或损坏版本元数据明确拒绝，不通过过滤掩盖丢失", () => {
    expect(() => readLibraryResponse([book, book])).toThrow("重复BookID");
    expect(() => readLibraryResponse([book, { ...book, id: "b" }])).toThrow("EditionID重复");
    expect(() => readLibraryResponse([{ ...book, editions: [{ id: "bad" }] }])).toThrow("版本数据不完整");
  });
  it("恢复旧版而不是最新，不能使用另一Book的缓存版本", () => {
    expect(rememberedEdition(book, "old")).toBe("old"); expect(rememberedEdition(book, "foreign")).toBeUndefined();
    expect(bookEditionUrl("a", "old")).toBe("/api/books/a?editionId=old");
  });
  it("显式版本请求必须匹配返回正文的书籍与版本", () => {
    const response = { ...book, editionId: "old", chapters: [{ id: "c-old", title: "旧章", paragraphs: [{ id: "p-old", text: "旧文" }] }] };
    expect(readBookResponse(response, "a", "old")).toMatchObject({ editionId: "old", edition: old });
    expect(() => readBookResponse(response, "a", "new")).toThrow("不匹配");
    expect(() => readBookResponse(response, "b", "old")).toThrow("不匹配");
    expect(() => readBookResponse({ ...response, editionId: "foreign" }, "a")).toThrow("不属于");
  });
});

describe("dual-track public contract", () => {
  it("retains original metadata and the exact source href, without changing paragraphs", () => {
    const metadata = { ...old, hasOriginalFile: true, fileSize: 123, originalHash: "a".repeat(64), readerMode: "text" };
    const response = { ...book, editions: [metadata], editionId: "old", chapters: [{ id: "c", title: "t", sourceHref: "OPS/Text/chapter%20one.xhtml#part", paragraphs: [{ id: "p", text: "  preserved text  " }] }] };
    const result = readBookResponse(response, "a", "old");
    expect(result.edition).toEqual(metadata); expect(result.chapters).toEqual(response.chapters);
  });
  it.each([{ readerMode: "epub" }, { originalHash: "not a hash" }, { fileSize: -1 }, { hasOriginalFile: 1 }])("rejects malformed original metadata %j", fields => {
    expect(() => readLibraryResponse([{ ...book, editions: [{ ...old, ...fields }] }])).toThrow("版本数据不完整");
  });
  it("rejects malformed sourceHref but accepts legacy chapters without it", () => {
    const response = { ...book, editionId: "old", chapters: [{ id: "c", title: "t", paragraphs: [{ id: "p", text: "original" }] }] };
    expect(readBookResponse(response, "a").chapters[0]).not.toHaveProperty("sourceHref");
    expect(() => readBookResponse({ ...response, chapters: [{ ...response.chapters[0], sourceHref: 42 }] }, "a")).toThrow("章节数据不完整");
  });
});
