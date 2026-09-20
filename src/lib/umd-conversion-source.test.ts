import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { convertUmdFile } from "./umd-conversion";
import { makeUmdFixture } from "./umd-fixture";
import { mapEpubDocument, rangeForEpubAnchor, selectionFromEpubRange } from "./epub-source-map";

describe("UMD转换正文与EPUB显示来源一致，不重写旧解析器规则", () => {
  it("字面实体、HTML样式文本、与标题同文段落都能精确回跳", async () => {
    const literal = "字面 &lt;tag&gt; &#x41; &#65; &amp; 不是HTML或实体。";
    const heading = "正文也是标题";
    const converted = await convertUmdFile(makeUmdFixture({ chapters: [{ title: heading, text: `${heading}\n${literal}\u2029<script>这也是原文😀</script>` }] }));
    expect(converted.document.chapters[0].paragraphs).toEqual([heading, literal, "<script>这也是原文😀</script>"]);
    const zip = await JSZip.loadAsync(converted.epub), source = converted.document.chapters[0];
    const html = await zip.file(source.sourceHref!)!.async("string");
    const doc = new JSDOM(html, { contentType: "application/xhtml+xml" }).window.document;
    expect(doc.querySelector("parsererror")).toBeNull(); expect(doc.querySelector("script")).toBeNull();
    const chapter = { id: "new-umd-chapter", title: source.title, paragraphs: source.paragraphs.map((text, index) => ({ id: "p" + index, text })) };
    const maps = mapEpubDocument(doc, chapter); expect(maps).toHaveLength(3);
    for (const paragraph of chapter.paragraphs) {
      const range = rangeForEpubAnchor(maps, paragraph.id, 0, paragraph.text.length)!;
      expect(range).not.toBeNull(); expect(range.toString()).toBe(paragraph.text);
      expect(selectionFromEpubRange(range, maps)?.text).toBe(paragraph.text);
    }
  });
  it("空行和空白保留在EPUB，而正文段落保留非空行的原有空格", async () => {
    const result = await convertUmdFile(makeUmdFixture({ chapters: [{ title: "空白", text: "  第一行  \r\n\r\n\t第二行\t\u2029" }] }));
    expect(result.document.chapters[0].paragraphs).toEqual(["  第一行  ", "\t第二行\t"]);
    const zip = await JSZip.loadAsync(result.epub), html = await zip.file(result.chapters[0].href)!.async("string");
    const doc = new JSDOM(html, { contentType: "application/xhtml+xml" }).window.document;
    expect(doc.querySelector("#umd-body")!.textContent).toBe("  第一行  \r\n\r\n\t第二行\t\u2029");
  });
});
