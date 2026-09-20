import { describe, expect, it } from "vitest";
import { bookEditionUrl, readBookResponse, readLibraryConversion, readLibraryResponse, rememberedEdition, type LibraryConversion, type LibraryEdition } from "./library";
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

const originalUmdHash = "a".repeat(64);
const derivedEpubHash = "b".repeat(64);
const conversion: LibraryConversion = {
  format: ".epub", sourceHash: originalUmdHash, fileHash: derivedEpubHash, fileSize: 2048,
  converterVersion: "umd-epub-v1", createdAt: "2026-09-20T04:00:00.000Z",
};
const convertedEdition: LibraryEdition = {
  id: "umd-v1", fileName: "原件.umd", fileType: ".umd", hasOriginalFile: true, originalHash: originalUmdHash,
  fileSize: 8192, readerMode: "text", createdAt: "2026-09-20T03:00:00.000Z", conversion,
};
const convertedBook = { ...book, editions: [convertedEdition, old] };
const convertedContent = {
  ...convertedBook, editionId: convertedEdition.id, edition: convertedEdition,
  chapters: [{ id: "chapter-1", title: "章", sourceHref: "OPS/chapter-0001.xhtml", paragraphs: [{ id: "p1", text: "原文😀" }] }],
};

// WHY：双份存储的公开契约只携带可校验身份，不依赖数据库、磁盘或UMD解析器。
describe("UMD转换版公开身份", () => {
  it("普通旧EPUB及缺少版本列表的旧响应不新增conversion", () => {
    expect(readLibraryResponse([book])).toEqual([book]);
    expect(readLibraryResponse([{ id: "legacy", title: "旧书", author: "作者" }]))
      .toEqual([{ id: "legacy", title: "旧书", author: "作者" }]);
    const selected = readBookResponse({ ...book, editionId: "old", chapters: [] }, "a", "old");
    expect(selected.edition).toEqual(old);
    expect(selected.edition).not.toHaveProperty("conversion");
  });

  it("书架与正文保留转换元数据，两种hash与两种大小互不覆盖", () => {
    const listing = readLibraryResponse([convertedBook]);
    expect(listing[0]).toEqual(convertedBook);
    const edition = listing[0].editions?.[0];
    expect(edition?.originalHash).toBe(originalUmdHash);
    expect(edition?.fileSize).toBe(8192);
    expect(edition?.conversion).toEqual(conversion);
    expect(edition?.conversion?.fileHash).not.toBe(edition?.originalHash);
    expect(edition?.conversion).not.toBe(conversion);
    const response = readBookResponse(convertedContent, "a", convertedEdition.id);
    expect(response.edition).toEqual(convertedEdition);
    expect(response.editions).toEqual(convertedBook.editions);
    expect(response.chapters).toEqual(convertedContent.chapters);
    expect(readBookResponse({ ...convertedContent, edition: undefined }, "a").edition).toEqual(convertedEdition);
  });

  it("显式选中版本在没有列表的响应中也经过完整验证并保留", () => {
    const response = { id: "a", title: "书", author: "作者", editionId: convertedEdition.id, edition: convertedEdition, chapters: [] };
    expect(readBookResponse(response, "a").edition?.conversion).toEqual(conversion);
    expect(() => readBookResponse({ ...response, edition: { ...convertedEdition, conversion: null } }, "a")).toThrow("转换版本");
  });

  it.each([1, 64 * 1024 * 1024])("转换文件大小边界%i合法", fileSize => {
    expect(readLibraryConversion({ ...conversion, fileSize }, convertedEdition).fileSize).toBe(fileSize);
  });

  it.each([null, false, 0, "{}", [], {}])("拒绝无效conversion %j，不按缺失处理", value => {
    const editions = [{ ...convertedEdition, conversion: value }];
    expect(() => readLibraryResponse([{ ...book, editions }])).toThrow("转换版本");
    expect(() => readBookResponse({ ...convertedContent, editions, edition: undefined }, "a")).toThrow("转换版本");
  });

  it.each([
    ["format", "epub"], ["format", ".pdf"], ["format", undefined],
    ["sourceHash", "A".repeat(64)], ["sourceHash", "a".repeat(63)], ["sourceHash", originalUmdHash + "\n"],
    ["fileHash", "B".repeat(64)], ["fileHash", "b".repeat(65)], ["fileHash", "not-a-hash"], ["fileHash", undefined],
    ["fileSize", 0], ["fileSize", -1], ["fileSize", 1.5], ["fileSize", 64 * 1024 * 1024 + 1],
    ["fileSize", NaN], ["fileSize", Infinity], ["fileSize", "2048"], ["fileSize", undefined],
    ["converterVersion", "umd-epub-v2"], ["converterVersion", undefined],
    ["createdAt", ""], ["createdAt", " \t\n"], ["createdAt", null], ["createdAt", 123],
  ] as const)("严格拒绝转换字段%s异常", (field, value) => {
    const bad = { ...conversion, [field]: value };
    expect(() => readLibraryConversion(bad, convertedEdition)).toThrow("转换版本");
    expect(() => readLibraryResponse([{ ...book, editions: [{ ...convertedEdition, conversion: bad }] }])).toThrow("转换版本");
  });

  it.each([
    { fileType: ".epub" }, { fileType: "umd" }, { fileType: ".UMD" },
    { hasOriginalFile: false }, { hasOriginalFile: undefined }, { originalHash: undefined },
    { originalHash: "c".repeat(64) }, { originalHash: derivedEpubHash },
  ])("只允许匹配的.umd原件身份 %j", fields => {
    const edition = { ...convertedEdition, ...fields };
    expect(() => readLibraryConversion(conversion, edition)).toThrow("身份不匹配");
    expect(() => readLibraryResponse([{ ...book, editions: [edition] }])).toThrow("身份不匹配");
    expect(() => readBookResponse({ ...convertedContent, editions: [edition], edition }, "a")).toThrow("身份不匹配");
  });

  it("不能用无效原件SHA或伪布尔值满足纯helper身份条件", () => {
    expect(() => readLibraryConversion(conversion, { ...convertedEdition, originalHash: "A".repeat(64) })).toThrow("身份不匹配");
    const fake = { ...convertedEdition, hasOriginalFile: 1 } as unknown as LibraryEdition;
    expect(() => readLibraryConversion(conversion, fake)).toThrow("身份不匹配");
  });

  it("顶层edition中的坏转换JSON对象和身份不符不能被列表掩盖", () => {
    for (const value of [null, "{}", { ...conversion, sourceHash: derivedEpubHash }]) {
      expect(() => readBookResponse({ ...convertedContent, edition: { ...convertedEdition, conversion: value } }, "a")).toThrow("转换版本");
    }
    expect(() => readBookResponse({ ...convertedContent, edition: { ...convertedEdition, id: "other" } }, "a")).toThrow("身份不匹配");
    expect(() => readBookResponse({ ...convertedContent, editionId: undefined }, "a")).toThrow("身份不匹配");
  });

  it("两份选中版本元数据不能各自合法却互相矛盾", () => {
    for (const value of [undefined, { ...conversion, fileHash: "c".repeat(64) }, { ...conversion, fileSize: 4096 }]) {
      expect(() => readBookResponse({ ...convertedContent, edition: { ...convertedEdition, conversion: value } }, "a"))
        .toThrow("列表元数据不匹配");
    }
  });

  it("未选中的版本也严格验证，不能隐藏坏转换元数据", () => {
    expect(() => readBookResponse({ ...convertedContent, editionId: "old", edition: old,
      editions: [{ ...convertedEdition, conversion: { ...conversion, fileHash: "bad" } }, old] }, "a", "old")).toThrow("转换版本");
  });

  it("双层显式白名单剔除私有路径/映射/额外字段，并返回新对象", () => {
    const privateConversion = { ...conversion, file_path: "PRIVATE_PATH", source_map_json: "PRIVATE_MAP", internal: true };
    const privateEdition = { ...convertedEdition, conversion: privateConversion, original_file_path: "PRIVATE_SOURCE" };
    const response = readBookResponse({ ...convertedContent, editions: [privateEdition, old], edition: privateEdition }, "a");
    expect(response.edition).toEqual(convertedEdition);
    expect(Object.keys(response.edition!.conversion!).sort()).toEqual(["converterVersion", "createdAt", "fileHash", "fileSize", "format", "sourceHash"]);
    expect(JSON.stringify(response)).not.toMatch(/PRIVATE|file_path|source_map_json|internal/);
    expect(privateConversion).toHaveProperty("file_path", "PRIVATE_PATH");
  });
});
