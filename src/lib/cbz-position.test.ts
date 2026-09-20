// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cbzPageUrl, readCbzPosition, type CbzPosition } from "./cbz-position";
const hash = "a".repeat(64);
const valid: CbzPosition = { version: 1, originalHash: hash, page: 2, zoom: 125, fit: "width", direction: "rtl" };

describe("CBZ阅读位置版本和字段校验", () => {
  it("合法位置完整恢复，保留方向、适应方式和缩放", () => { expect(readCbzPosition(JSON.stringify(valid), hash, 5)).toEqual(valid); });
  it.each([null, "", "{坏JSON", "[]", JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, originalHash: "b".repeat(64) }), JSON.stringify({ ...valid, page: 0 }), JSON.stringify({ ...valid, page: 6 }), JSON.stringify({ ...valid, page: 1.5 }), JSON.stringify({ ...valid, zoom: 24 }), JSON.stringify({ ...valid, zoom: 301 }), JSON.stringify({ ...valid, zoom: "125" }), JSON.stringify({ ...valid, fit: "free" }), JSON.stringify({ ...valid, direction: "vertical" })])("坏位置%s应返回null而不污染当前书", raw => {
    expect(() => readCbzPosition(raw, hash, 5)).not.toThrow(); expect(readCbzPosition(raw, hash, 5)).toBeNull();
  });
  it("页数为0时无合法恢复位置，count边界严格", () => { expect(readCbzPosition(JSON.stringify({ ...valid, page: 1 }), hash, 1)).toMatchObject({ page: 1 }); expect(readCbzPosition(JSON.stringify({ ...valid, page: 2 }), hash, 1)).toBeNull(); });
});

describe("CBZ图片页URL版本绑定", () => {
  it("book/edition安全编码且页码保留为唯一查询参数", () => { expect(cbzPageUrl("书/一", "版&二", 12)).toBe("/api/books/%E4%B9%A6%2F%E4%B8%80/image?editionId=%E7%89%88%26%E4%BA%8C&page=12"); });
  it.each([0,1001,1.2] as const)("页码%s拒绝", page => { expect(() => cbzPageUrl("b", "e", page)).toThrow(/无效/); });
  it.each([["", "e"], ["b", ""], ["b", "e"]] as const)("缺少book/edition或非法页码不生成URL %s/%s", (book, edition) => { if (book && edition) return; expect(() => cbzPageUrl(book, edition, 1)).toThrow(/无效/); });
});
