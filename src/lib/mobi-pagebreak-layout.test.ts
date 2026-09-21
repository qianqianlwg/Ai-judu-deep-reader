import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { expect, it } from "vitest";
import { makeMobiFixture } from "./mobi-fixture";
import { parseMobiFile } from "./mobi-parser";
import { publishMobiFile } from "./mobi-publication-server";
import type { MobiPublication, MobiPublicationPoint } from "./mobi-publication-model";

function documentFor(html: string): Document {
  const dom = new JSDOM("<!doctype html><body></body>");
  dom.window.document.body.innerHTML = html;
  return dom.window.document;
}

function pointNode(html: string, point: MobiPublicationPoint): Node {
  const document = documentFor(html);
  let node: Node = document.body;
  for (const index of point.path) {
    const child = node.childNodes[index];
    expect(child).toBeDefined();
    if (!child) throw new Error("MOBI发布目标路径不存在");
    node = child;
  }
  return node;
}

function chapterRoot(publication: MobiPublication, index: number): Element {
  const document = documentFor(publication.chapters[index].html);
  const root = document.body.firstElementChild;
  expect(root).not.toBeNull();
  if (!root) throw new Error("MOBI发布章节缺少根元素");
  return root;
}

function targetText(publication: MobiPublication, navigationIndex: number): string {
  const navigation = publication.navigation[navigationIndex];
  expect(navigation).toBeDefined();
  if (!navigation) throw new Error("MOBI发布导航目标不存在");
  const chapterIndex = publication.chapters.findIndex(chapter => chapter.id === navigation.chapterId);
  expect(chapterIndex).toBeGreaterThanOrEqual(0);
  if (chapterIndex < 0) throw new Error("MOBI发布导航章节不存在");
  const node = pointNode(publication.chapters[chapterIndex].html, navigation.point);
  if (navigation.point.kind === "text") {
    expect(node.nodeType).toBe(3);
    const text = node.textContent ?? "";
    expect(text.length).toBe(navigation.point.textLength);
    expect(createHash("sha256").update(text).digest("hex")).toBe(navigation.point.textHash);
    return text.slice(navigation.point.offset);
  }
  expect(node.nodeType).toBe(1);
  return node.textContent ?? "";
}

it("MOBI6跨pagebreak保留嵌套section的class/style/lang/dir上下文", async () => {
  const bytes = makeMobiFixture({
    text: '<html><body><section class="chapter" style="color:red" lang="zh-Hans" dir="rtl"><p>第一页</p><mbp:pagebreak/><p>第二页</p></section></body></html>',
  });
  const publication = await publishMobiFile(bytes);

  expect(publication.chapters).toHaveLength(2);
  for (const [index, text] of ["第一页", "第二页"].entries()) {
    const section = chapterRoot(publication, index);
    expect(section.localName).toBe("section");
    expect(section.getAttribute("class")).toBe("chapter");
    expect(section.getAttribute("style")).toContain("color");
    expect(section.getAttribute("lang")).toBe("zh-Hans");
    expect(section.getAttribute("dir")).toBe("rtl");
    expect(section.querySelector("p")?.textContent).toBe(text);
  }
}, 20_000);

it("MOBI6跨pagebreak保留嵌套块与引用层级", async () => {
  const publication = await publishMobiFile(makeMobiFixture({
    text: '<html><body><section class="chapter"><div class="content"><blockquote class="quotation" lang="zh"><p>引用上半</p><mbp:pagebreak/><p>引用下半</p></blockquote></div></section></body></html>',
  }));

  expect(publication.chapters).toHaveLength(2);
  for (const [index, text] of ["引用上半", "引用下半"].entries()) {
    const root = chapterRoot(publication, index);
    expect(root.matches("section.chapter")).toBe(true);
    const quote = root.querySelector(":scope > div.content > blockquote.quotation");
    expect(quote?.getAttribute("lang")).toBe("zh");
    expect(quote?.querySelector("p")?.textContent).toBe(text);
  }
}, 20_000);

it("MOBI6列表项内分页时续文和下一项编号不偏移", async () => {
  const publication = await publishMobiFile(makeMobiFixture({ text: '<html><body><ol start="4"><li>第四项前半<mbp:pagebreak/>第四项后半</li><li>第五项</li></ol></body></html>' }));
  expect(publication.chapters).toHaveLength(2);
  const second = chapterRoot(publication, 1);
  const list = second.localName === "ol" ? second : second.querySelector("ol");
  expect(list?.getAttribute("start")).toBe("4");
  expect([...list?.querySelectorAll("li") ?? []].map(item => item.textContent)).toEqual(["第四项后半", "第五项"]);
}, 20_000);

it("MOBI6跨pagebreak保持ol列表并从start序号继续", async () => {
  const publication = await publishMobiFile(makeMobiFixture({
    text: '<html><body><ol start="4"><li>第四项</li><mbp:pagebreak/><li>第五项</li></ol></body></html>',
  }));

  expect(publication.chapters).toHaveLength(2);
  const firstRoot = chapterRoot(publication, 0), secondRoot = chapterRoot(publication, 1);
  const first = firstRoot.localName === "ol" ? firstRoot : firstRoot.querySelector("ol");
  const second = secondRoot.localName === "ol" ? secondRoot : secondRoot.querySelector("ol");
  expect(first?.getAttribute("start")).toBe("4");
  expect(first?.querySelector("li")?.textContent).toBe("第四项");
  expect(second?.getAttribute("start")).toBe("5");
  expect(second?.querySelector("li")?.textContent).toBe("第五项");
}, 20_000);

it("MOBI6跨pagebreak保持hidden祖先，子段不会重新变为可见", async () => {
  const publication = await publishMobiFile(makeMobiFixture({
    text: '<html><body><section hidden><p>隐藏第一页</p><mbp:pagebreak/><p>隐藏第二页</p></section></body></html>',
  }));

  expect(publication.chapters).toHaveLength(2);
  for (const [index, text] of ["隐藏第一页", "隐藏第二页"].entries()) {
    const section = chapterRoot(publication, index);
    expect(section.hasAttribute("hidden")).toBe(true);
    expect(section.querySelector("p")?.textContent).toBe(text);
  }
}, 20_000);

it("MOBI6跨章filepos在重复Unicode实体文本中仍指向准确目标", async () => {
  const repeated = "<p>重复😀 &amp; 相同</p>";
  let html = `<html><body><section class="chapter"><p>第一页</p><a filepos="0000000000">跳转</a><mbp:pagebreak/><p>第二页</p>${repeated}${repeated}</section></body></html>`;
  const targetOffset = Buffer.byteLength(html.slice(0, html.lastIndexOf("重复😀")));
  html = html.replace('filepos="0000000000"', `filepos="${String(targetOffset).padStart(10, "0")}"`);
  const publication = await publishMobiFile(makeMobiFixture({ text: html }));

  expect(publication.chapters).toHaveLength(2);
  expect(publication.navigation).toHaveLength(1);
  expect(publication.navigation[0]?.chapterId).toBe(publication.chapters[1]?.id);
  const second = chapterRoot(publication, 1);
  expect([...second.querySelectorAll("p")].map(paragraph => paragraph.textContent)).toEqual([
    "第二页",
    "重复😀 & 相同",
    "重复😀 & 相同",
  ]);
  expect(targetText(publication, 0)).toBe("重复😀 & 相同");
  const target = publication.navigation[0]?.point;
  expect(target?.kind).toBe("text");
  if (target?.kind === "text") expect(target.offset).toBe(0);
}, 20_000);

it("MOBI6跨pagebreak发布各章真实标题而不吞正文", async () => {
  const publication = await publishMobiFile(makeMobiFixture({
    text: "<html><body><h1>第一章标题</h1><p>第一章正文</p><mbp:pagebreak/><h2>第二章标题</h2><p>第二章正文</p></body></html>",
  }));

  expect(publication.chapters.map(chapter => chapter.title)).toEqual(["第一章标题", "第二章标题"]);
  const first = documentFor(publication.chapters[0].html), second = documentFor(publication.chapters[1].html);
  expect(first.querySelector("h1")?.textContent).toBe("第一章标题");
  expect(first.querySelector("p")?.textContent).toBe("第一章正文");
  expect(second.querySelector("h2")?.textContent).toBe("第二章标题");
  expect(second.querySelector("p")?.textContent).toBe("第二章正文");
}, 20_000);

it("MOBI6静态图片跨pagebreak后保持祖先并发布同一真实资源", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#2474c6" } }).png().toBuffer();
  const publication = await publishMobiFile(makeMobiFixture({
    resources: [png],
    text: '<html><body><section class="illustrated"><figure><p>图前</p><img recindex="1" alt="前图"></figure><mbp:pagebreak/><figure><p>图后</p><img recindex="1" alt="后图"></figure></section></body></html>',
  }));

  expect(publication.chapters).toHaveLength(2);
  expect(publication.resources).toHaveLength(1);
  expect(publication.resources[0]).toMatchObject({ id: "mobi-resource-v1/1.png", mediaType: "image/png" });
  expect(Buffer.from(publication.resources[0].base64, "base64")).toEqual(png);
  for (const [index, values] of [["图前", "前图"], ["图后", "后图"]].entries()) {
    const section = chapterRoot(publication, index);
    expect(section.matches("section.illustrated")).toBe(true);
    expect(section.querySelector("figure > p")?.textContent).toBe(values[0]);
    const image = section.querySelector("figure > img");
    expect(image?.getAttribute("src")).toBe("mobi-resource-v1/1.png");
    expect(image?.getAttribute("alt")).toBe(values[1]);
  }
}, 20_000);

it("MOBI6普通平面分章保持原有parseMobiFile段落结果", async () => {
  const bytes = makeMobiFixture({ text: "<html><body><p>第一段</p><mbp:pagebreak/><p>第二段</p></body></html>" });
  const [parsed, publication] = await Promise.all([parseMobiFile(bytes, "flat.mobi"), publishMobiFile(bytes)]);

  expect(parsed.chapters.map(chapter => chapter.paragraphs)).toEqual([["第一段"], ["第二段"]]);
  expect(publication.chapters).toHaveLength(2);
  expect(publication.chapters.map(chapter => documentFor(chapter.html).body.textContent)).toEqual(["第一段", "第二段"]);
}, 20_000);
