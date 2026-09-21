import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
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
  expect(targetText(publication, 0)).toBe("重复😀 & 相同");
  const target = publication.navigation[0]?.point;
  expect(target?.kind).toBe("text");
  if (target?.kind === "text") expect(target.offset).toBe(0);
}, 20_000);

it("MOBI6普通平面分章保持原有parseMobiFile段落结果", async () => {
  const bytes = makeMobiFixture({ text: "<html><body><p>第一段</p><mbp:pagebreak/><p>第二段</p></body></html>" });
  const parsed = await parseMobiFile(bytes, "flat.mobi");

  expect(parsed.chapters.map(chapter => chapter.paragraphs)).toEqual([["第一段"], ["第二段"]]);
}, 20_000);
