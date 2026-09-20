import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { convertUmdFile } from "./umd-conversion";
import { makeUmdFixture } from "./umd-fixture";
import { validateEpubImport } from "./epub-import-security";
import { parseEpubFile } from "./epub-parser";

describe("自造UMD原件→真实隔离解析→EPUB→既有精读提取闭环", () => {
  it("顺序、中文、emoji和来源绑定正确；转换不覆盖或篡改原件", async () => {
    const bytes = makeUmdFixture({ indexOrder: [1, 0] }), original = Buffer.from(bytes);
    const result = await convertUmdFile(bytes);
    expect(bytes).toEqual(original);
    expect(result.sourceHash).toBe(createHash("sha256").update(original).digest("hex"));
    expect(result.epubHash).toBe(createHash("sha256").update(result.epub).digest("hex")); expect(result.epubHash).not.toBe(result.sourceHash);
    expect(result.sourceSize).toBe(original.length); expect(result.converterVersion).toBe("umd-epub-v1");
    await validateEpubImport(result.epub);
    const directory = await mkdtemp(path.join(os.tmpdir(), "judu-umd-conversion-"));
    try {
      const source = path.join(directory, "original.umd"), target = path.join(directory, "converted.epub");
      await writeFile(source, original); await writeFile(target, result.epub);
      const parsed = await parseEpubFile(target);
      expect(parsed.title).toBe("UMD本地自造样本"); expect(parsed.author).toBe("测试作者");
      expect(parsed.chapters).toHaveLength(2);
      expect(parsed.chapters.map(chapter => chapter.sourceHref)).toEqual(result.chapters.map(chapter => chapter.href));
      expect(parsed.chapters[0].paragraphs.join("\n")).toContain("中文与emoji😀。");
      // WHY：既有EPUB导入仍有历史空白规则；它只证明兼容读入，不作为UMD来源真值。
      expect(parsed.chapters[0].paragraphs.join("\n")).toContain("逐字保留 <公式> &符号。");
      expect(result.document.chapters[0].paragraphs).toContain("逐字保留 <公式>&符号。");
      expect(parsed.chapters[1].paragraphs.join("\n")).toContain("第二段正文。");
      expect(await readFile(source)).toEqual(original);
    } finally {
      if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("judu-umd-conversion-")) throw new Error("清理越界");
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("PNG封面字节往返且不是只信任图片头", async () => {
    const cover = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
    const result = await convertUmdFile(makeUmdFixture({ cover })), zip = await JSZip.loadAsync(result.epub);
    expect(await zip.file("OPS/cover.png")!.async("nodebuffer")).toEqual(cover);
    await expect(convertUmdFile(makeUmdFixture({ cover: cover.subarray(0, 10) }))).rejects.toThrow();
  });
  it("无效原件、未经支持的图文型和取消均明确失败", async () => {
    await expect(convertUmdFile(makeUmdFixture({ kind: 2 }))).rejects.toThrow("文字型");
    await expect(convertUmdFile(makeUmdFixture({ terminator: false }))).rejects.toThrow("终止");
    const controller = new AbortController(); controller.abort();
    await expect(convertUmdFile(makeUmdFixture(), { signal: controller.signal })).rejects.toThrow("取消");
  });
  it("重复转换字节和两种哈希均稳定", async () => {
    const input = makeUmdFixture(); const a = await convertUmdFile(input), b = await convertUmdFile(input);
    expect(a).toEqual(b);
  });
});

it("独立错序回归：逆序ID表不得交换AAAA/BBBB及对应来源范围", async () => {
  const input = makeUmdFixture({ chapters: [{ title: "甲", text: "AAAA" }, { title: "乙", text: "BBBB" }],
    textParts: [Buffer.from("AAAA", "utf16le"), Buffer.from("BBBB", "utf16le")], indexOrder: [1, 0] });
  const result = await convertUmdFile(input);
  expect(result.document.chapters.map(chapter => chapter.paragraphs)).toEqual([["AAAA"], ["BBBB"]]);
  expect(result.chapters.map(chapter => [chapter.startByte, chapter.endByte])).toEqual([[0, 8], [8, 16]]);
  const zip = await JSZip.loadAsync(result.epub);
  const first = await zip.file(result.chapters[0].href)!.async("string"), second = await zip.file(result.chapters[1].href)!.async("string");
  expect(first).toContain("AAAA"); expect(first).not.toContain("BBBB"); expect(second).toContain("BBBB");
});
