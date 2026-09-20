import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEpubFile, type ParsedEpub } from "./epub-parser";
const fixtureDir = process.env.EPUB_FIXTURE_DIR;
const providedSampleSha256 = "20b854d3fcc088a16c01d6f1998325056b8ea78734e83be46c559ed27a0a070a";
// WHY：真实书籍仅从用户明确设置的本地目录读取，不入库、不上传；普通 CI 不依赖个人下载文件。
describe.skipIf(!fixtureDir)("用户提供的真实 EPUB 回归", () => {
  const samples: { sha256: string; result: ParsedEpub }[] = [];
  beforeAll(async () => {
    const files = (await readdir(fixtureDir!)).filter(name => name.toLowerCase().endsWith(".epub"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const filename = path.join(fixtureDir!, name);
      const sha256 = createHash("sha256").update(await readFile(filename)).digest("hex");
      samples.push({ sha256, result: await parseEpubFile(filename) });
    }
  });
  it("所有文件章节可解析，且无中英文目录页混入正文", () => {
    for (const { result } of samples) {
      expect(result.chapters.length).toBeGreaterThan(0);
      expect(result.chapters.every(chapter => chapter.paragraphs.length > 0)).toBe(true);
      expect(result.chapters.some(chapter => /^(目录|目錄|contents|tableofcontents)$/iu.test(chapter.title.replace(/[\s\u200B-\u200D]/gu, "").replace(/[：:]$/u, "")))).toBe(false);
    }
  });
  it("哈希锁定的已知样本保留献词题辞及正文边界", ({ skip }) => {
    // WHY：特定书籍的章节数不能强加给其他 EPUB；未提供同一原件时明确跳过，不能伪称该样本验收通过。
    const sample = samples.find(item => item.sha256 === providedSampleSha256);
    if (!sample) return skip();
    const { result } = sample;
    expect(result.chapters).toHaveLength(58);
    expect(result.chapters.reduce((count, chapter) => count + chapter.paragraphs.length, 0)).toBe(1222);
    expect(result.chapters.slice(0, 2).map(chapter => [chapter.title, chapter.sourceHref, chapter.paragraphs.length])).toEqual([
      ["未命名章节 1", "OEBPS/Text/part0003.xhtml", 1],
      ["未命名章节 2", "OEBPS/Text/part0004.xhtml", 6],
    ]);
    expect(result.chapters[2].title).toMatch(/^前言/u);
    expect(result.chapters[4].title).toMatch(/^第一章/u);
    expect(result.chapters.at(-1)?.title).toBe("参考文献");
    expect(new Set(result.chapters.map(chapter => chapter.sourceHref)).size).toBe(58);
    expect(result.chapters.some(chapter => /part000[12]\.xhtml$/u.test(chapter.sourceHref))).toBe(false);
  });
});
