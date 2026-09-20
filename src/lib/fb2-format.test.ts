import { describe, expect, it } from "vitest";
import { fb2ArchiveFile, isCompressedFb2, isFb2Format } from "./fb2-format";

describe("FB2 格式识别不扩大到其他格式", () => {
  it.each(["fb2", "FB2", ".fb2", ".Fb2"])("识别原始格式 %s，不当成压缩归档", format => {
    expect(isFb2Format(format)).toBe(true);
    expect(isCompressedFb2(format)).toBe(false);
  });
  it.each(["fbz", "FBZ", ".fbz", "FbZ", "fb2.zip", ".FB2.ZIP", "Fb2.Zip"])("识别受支持的压缩扩展名 %s", format => {
    expect(isFb2Format(format)).toBe(true);
    expect(isCompressedFb2(format)).toBe(true);
  });
  it.each(["", "zip", ".zip", "epub", "pdf", "mobi", "fb2.gz", "raw.FB2", "raw.fb2.zip", "fb2.xml", "fb20", "fb2 ", " fbz", "..fbz"])("不能将格式参数 %j 猜成 FB2", format => {
    expect(isFb2Format(format)).toBe(false);
    expect(isCompressedFb2(format)).toBe(false);
  });
});

describe("FBZ 正文文件选择规则", () => {
  it.each(["raw.FB2", "raw.fb2", "Raw.Fb2", "text/book.fb2", "目录/正文.FB2", "a multi word name.fb2"])("选择唯一合法文档 %s，原样保留路径及大小写", name => {
    expect(fb2ArchiveFile([{ name, directory: false }])).toBe(name);
  });
  it("允许显式空目录，但只返回唯一文件，不排序猜正文", () => {
    const entries = Object.freeze([
      { name: "raw.FB2/", directory: true }, { name: "unused/", directory: true },
      { name: "books/", directory: true }, { name: "books/raw.FB2", directory: false },
    ]);
    expect(fb2ArchiveFile(entries)).toBe("books/raw.FB2");
    expect(entries.map(entry => entry.name)).toEqual(["raw.FB2/", "unused/", "books/", "books/raw.FB2"]);
  });
  it.each([
    [], [{ name: "raw.FB2/", directory: true }],
    [{ name: "chapter.xml", directory: false }], [{ name: "raw.FB2.txt", directory: false }],
    [{ name: "raw.fb2", directory: false }, { name: "second.FB2", directory: false }],
    [{ name: "raw.fb2", directory: false }, { name: "cover.png", directory: false }],
    [{ name: "raw.fb2", directory: false }, { name: "mimetype", directory: false }],
    [{ name: "raw.fb2", directory: false }, { name: "__MACOSX/._raw.fb2", directory: false }],
  ].map(entries => ({ entries })))("拒绝空/仅目录/非FB2/多个文件，不忽略附加文件：$entries", ({ entries }) => {
    expect(() => fb2ArchiveFile(entries)).toThrow("只包含一个FB2文件");
  });
});

