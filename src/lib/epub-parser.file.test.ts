import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEpubFile } from "./epub-parser";

type Section = { html: string; label?: string };
let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "judu-parser-regression-")); });
afterAll(async () => {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-parser-regression-")) throw new Error("测试目录不安全");
  await rm(resolved, { recursive: true, force: true });
});
async function parseSections(sections: Section[]) {
  // WHY：使用自造 EPUB 穿过真实依赖与 NCX/spine 路径，回归测试不携带用户书籍或调用远端服务。
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const manifest = sections.map((_, index) => `<item id="s${index}" href="s${index}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = sections.map((_, index) => `<itemref idref="s${index}"/>`).join("");
  zip.file("OPS/book.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">synthetic-regression</dc:identifier><dc:title>合成回归书</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh</dc:language></metadata><manifest>${manifest}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx">${spine}</spine></package>`);
  const points = sections.flatMap((section, index) => section.label ? [`<navPoint id="n${index}" playOrder="${index + 1}"><navLabel><text>${section.label}</text></navLabel><content src="s${index}.xhtml"/></navPoint>`] : []);
  zip.file("OPS/toc.ncx", `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>合成回归书</text></docTitle><navMap>${points.join("")}</navMap></ncx>`);
  sections.forEach((section, index) => zip.file(`OPS/s${index}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>资源 ${index}</title></head><body>${section.html}</body></html>`));
  const filename = path.join(directory, "synthetic.epub");
  await writeFile(filename, await zip.generateAsync({ type: "nodebuffer" }));
  return parseEpubFile(filename);
}

describe("EPUB 真实依赖提取回归", () => {
  it("过滤中文目录和版权元数据，但保留题献、题辞与准确的 sourceHref", async () => {
    const result = await parseSections([
      { html: '<p>图书在版编目（CIP）数据</p><p>ISBN：978-1-23456-789-0</p>' },
      { html: '<h1>目　录</h1><p class="contents"><a href="s4.xhtml">第一章</a></p>' },
      { html: '<p>献给每一位读者</p>' },
      { html: '<p class="kaiti">先观察，再判断。</p><p class="signcontent">——测试作者</p>' },
      { html: '<h1>第一章　观察</h1><p>正文中文 <em>强调</em> 😀。</p><p>第二段。</p>' },
    ]);
    expect(result.title).toBe("合成回归书");
    expect(result.chapters).toEqual([
      { title: "未命名章节 1", sourceHref: "OPS/s2.xhtml", paragraphs: ["献给每一位读者"] },
      { title: "未命名章节 2", sourceHref: "OPS/s3.xhtml", paragraphs: ["先观察，再判断。", "——测试作者"] },
      { title: "第一章 观察", sourceHref: "OPS/s4.xhtml", paragraphs: ["正文中文 强调 😀。", "第二段。"] },
    ]);
  });
  it("优先保留原书 NCX 标题，不把真的数字章名改成未命名", async () => {
    const result = await parseSections([{ label: "第1章", html: "<p>没有 h1 的正常正文。</p>" }]);
    expect(result.chapters[0]).toEqual({ title: "第1章", sourceHref: "OPS/s0.xhtml", paragraphs: ["没有 h1 的正常正文。"] });
  });
  it("未命名提示不是书内标题，正文偶然同文时也不能删除", async () => {
    const result = await parseSections([{ html: "<p>未命名章节 1</p><p>这一段属于正文。</p>" }]);
    expect(result.chapters[0].paragraphs).toEqual(["未命名章节 1", "这一段属于正文。"]);
  });
  it("含局部目录与 cover 插图样式的正文整章不会被丢弃", async () => {
    const result = await parseSections([{ html: '<h1>第一章</h1><div class="toc"><a href="#a">跳至正文</a></div><p id="a" class="discovery">完整保留的正文。</p><p class="cover-image">插图说明。</p>' }]);
    expect(result.chapters[0].paragraphs).toEqual(["完整保留的正文。", "插图说明。"]);
  });
  it("只包含目录和版权信息时明确报无正文，而非空成功", async () => {
    await expect(parseSections([
      { html: '<h1>目 录</h1><p><a href="s1.xhtml">编目信息</a></p>' },
      { html: '<p>图书在版编目（CIP）数据</p><p>ISBN 978-1-23456-789-0</p>' },
    ])).rejects.toThrow("EPUB 中没有提取到可阅读正文");
  });
});
