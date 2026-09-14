import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEpubFile } from "./epub-parser";
const fixtureDir = process.env.EPUB_FIXTURE_DIR;
// WHY：真实书籍属于用户本地资料，不入库，也不能让新机器的默认测试依赖某个个人下载目录。
describe.skipIf(!fixtureDir)("用户提供的真实 EPUB 回归", () => {
  it("所有章节可解析且无目录页混入正文", async () => {
    const files = (await readdir(fixtureDir!)).filter(name => name.toLowerCase().endsWith(".epub"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const result = await parseEpubFile(path.join(fixtureDir!,name));
      expect(result.chapters.length).toBeGreaterThan(0);
      expect(result.chapters.every(chapter=>chapter.paragraphs.length>0)).toBe(true);
      expect(result.chapters.some(chapter=>chapter.title.toLowerCase()==="table of contents")).toBe(false);
    }
  });
});
