import { describe, expect, it } from "vitest";
import { htmlToBlocks, isNavigationLabel, shouldSkipEpubSection } from "./epub-parser";

function skips(html: string, item: { id: string; href?: string; title?: string } = { id: "section" }): boolean {
  const { headings, paragraphs } = htmlToBlocks(html);
  return shouldSkipEpubSection(item, headings, paragraphs, html);
}

describe("EPUB 正文块解析", () => {
  it("提取标题和段落并去除标签与实体", () => {
    const result = htmlToBlocks("<h1>序言</h1><p>第一段&nbsp;文字。</p><p>第二段 <em>重要</em>。</p>");
    expect(result.headings).toEqual(["序言"]);
    expect(result.paragraphs).toEqual(["第一段 文字。", "第二段 重要。"]);
  });
  it("识别目录块但由章节过滤器负责跳过", () => {
    const result = htmlToBlocks('<div class="toc"><h1>目录</h1><ul><li><a>第一章</a></li></ul></div>');
    expect(result.headings).toEqual(["目录"]);
    expect(result.paragraphs).toEqual(["第一章"]);
  });
});

describe("EPUB 章节分类不修改正文", () => {
  it.each(["目  录", "目\u3000录", "目&nbsp;录", "目&#160;录", "目\u200B录", "目 錄", "目 录：", "Table of Contents", " CONTENTS "])("识别排版空白目录标签：%s", label => {
    expect(isNavigationLabel(label)).toBe(true);
    expect(skips(`<h1>${label}</h1><p><a>第一章</a></p>`)).toBe(true);
    expect(skips("<p><a>第一章</a></p>", { id: "section", title: label })).toBe(true);
  });
  it.each(["目录学概论", "目录中的世界", "Contents and context", "前言", "献给读者", "第1章"])("不把含目录词的正文标题误判为导航：%s", title => {
    expect(isNavigationLabel(title)).toBe(false);
    expect(skips(`<h1>${title}</h1><p>这是一段正文。</p>`)).toBe(false);
  });
  it.each(['class="toc"', 'class="contents"', 'id="table-of-contents"', 'epub:type="toc"', 'role="doc-toc"'])("无目录标题时识别只有链接的导航页：%s", marker => {
    expect(skips(`<nav ${marker}><ol><li><a href="one.xhtml">第一节</a></li><li><a href="two.xhtml">第二节</a></li></ol></nav>`)).toBe(true);
  });
  it("正文中存在局部目录不能导致整章丢失", () => {
    expect(skips('<h1>第一章</h1><nav class="toc"><a href="#part">本节索引</a></nav><p>这是后续正文。</p>')).toBe(false);
  });
  it.each(["stock", "discovery", "cover-image", "copyright-note", "kaiti", "signcontent"])("样式类 %s 不能代表非正文", className => {
    expect(skips(`<p class="${className}">没有标题的正文。</p>`)).toBe(false);
  });
  it("仅编目标题与独立 ISBN 字段同时出现时识别无标题版权页", () => {
    expect(skips('<p>图书在版编目（CIP）数据</p><p>作者与出版社</p><p>ISBN：978-1-23456-789-0</p>')).toBe(true);
    expect(skips('<p>图书在版编目（CIP）数据</p><p>此节讨论这种数据的来源。</p>')).toBe(false);
    expect(skips('<p>解释 ISBN 和 CIP 如何帮助检索。</p><p>本书版权制度的研究方法。</p>')).toBe(false);
    expect(skips('<h1>编目教程</h1><p>图书在版编目（CIP）数据</p><p>ISBN：978-1-23456-789-0</p>')).toBe(false);
  });
  it("保留未命名献词、题辞与普通正文", () => {
    expect(skips('<p>献给所有读者</p>')).toBe(false);
    expect(skips('<p class="kaiti">以证据为依据。</p><p class="signcontent">——合成作者</p>')).toBe(false);
    expect(skips('<p>这是没有标题但属于正文的段落。</p>')).toBe(false);
  });
  it("保留原有明确导航资源标识和空章节过滤", () => {
    expect(skips('<p>第一章</p>', { id: "toc" })).toBe(true);
    expect(skips('<p>第一章</p>', { id: "section", href: "OPS/nav.xhtml" })).toBe(true);
    expect(skips('<div><img src="cover.png"/></div>')).toBe(true);
  });
});
