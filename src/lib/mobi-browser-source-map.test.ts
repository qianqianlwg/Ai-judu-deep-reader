// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryChapter } from "./library";
import {
  anchorFromEpubRange, rangeForEpubAnchor, rangeForEpubPosition,
  readLimitedEpubSelection, selectionFromEpubRange,
} from "./epub-source-map";
import { capReadingSelection, selectionParts } from "./reader-selection";
import { mobiHtmlBlocks } from "./mobi-html.mjs";
import { mapMobiDocument } from "./mobi-browser-source-map";

const chapter = (texts: string[]): LibraryChapter => ({
  id: "c", title: "章", paragraphs: texts.map((text, index) => ({ id: `p${index}`, text })),
});
const fixture = (html: string) => new DOMParser().parseFromString(html, "text/html");
function projection(html: string, expected: string[]) {
  const extracted = mobiHtmlBlocks(html);
  expect(extracted.paragraphs).toEqual(expected);
  const doc = fixture(html), canonical = chapter(extracted.paragraphs);
  const before = doc.documentElement.outerHTML;
  const maps = mapMobiDocument(doc, canonical);
  expect(maps.map(map => map.paragraph.text)).toEqual(expected);
  for (const [index, map] of maps.entries()) {
    expect(map.paragraph).toBe(canonical.paragraphs[index]);
    expect(map.points.map(point => point.node.data[point.offset]).join("")).toBe(expected[index].replace(/\s/gu, ""));
    expect(map.offsets.map(offset => map.paragraph.text[offset]).join("")).toBe(expected[index].replace(/\s/gu, ""));
    expect(map.points.every(point => map.element.contains(point.node))).toBe(true);
  }
  expect(doc.documentElement.outerHTML).toBe(before);
  return { doc, maps };
}
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("MOBI 浏览器投影与 mobiHtmlBlocks 同构", () => {
  it("嵌套 div 的裸文本、内联文本和 p 分别 flush，不合并也不重复", () => {
    const { maps } = projection(
      '开头<div>甲<em>乙</em><p>丙<strong>丁</strong></p>戊<div>己<p>庚</p>辛</div>壬</div>结尾',
      ["开头", "甲乙", "丙丁", "戊", "己", "庚", "辛", "壬", "结尾"],
    );
    expect(maps.map(map => map.element.tagName)).toEqual(["BODY", "DIV", "P", "DIV", "DIV", "P", "DIV", "DIV", "BODY"]);
  });

  it.each(["p", "div", "section", "article", "blockquote", "li", "pre"])("%s 的进入和退出均切分正文", tag => {
    projection(`前<${tag}>中<em>文</em></${tag}>后`, ["前", "中文", "后"]);
  });

  it("br/td/th 补空格、空白折叠及 UTF-16 偏移与抽取器一致", () => {
    const { maps } = projection(
      '<p>甲<br>乙<br><br> 丙&nbsp;丁</p><table><tr><th>列一</th><th>列二</th></tr><tr><td>值<em>一</em></td><td>😀<br>值二</td></tr></table><pre>  A\n\tB  </pre>',
      ["甲 乙 丙 丁", "列一 列二", "值一 😀 值二", "A B"],
    );
    expect(maps[2].element.tagName).toBe("TR");
    expect(maps[2].offsets).toEqual([0, 1, 3, 4, 6, 7]);
    const emoji = rangeForEpubAnchor(maps, "p2", 3, 5)!;
    expect(emoji.toString()).toBe("😀");
    expect(selectionFromEpubRange(emoji, maps)).toEqual({ paragraphId: "p2", startOffset: 3, endOffset: 5, text: "😀" });
    expect(rangeForEpubPosition(maps, "p2", 2)?.toString()).toBe("\ud83d");
    expect(rangeForEpubPosition(maps, "p0", 1)?.toString()).toBe("乙");
  });

  it("只移除首个标题块，保留标题同文正文与 h2-h6", () => {
    const { doc, maps } = projection(
      '<p>序言</p><h1>同文</h1><p>同文</p><h2>同文</h2><h3>三级</h3><h4>四级</h4><h5>五级</h5><h6>六级</h6>',
      ["序言", "同文", "同文", "三级", "四级", "五级", "六级"],
    );
    expect(maps[1].element.tagName).toBe("P");
    expect(maps[2].element.tagName).toBe("H2");
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector("h1")!);
    expect(selectionFromEpubRange(range, maps)).toBeNull();
  });

  it("标题中的嵌套块继承 heading，移除的是首块而非整棵标题元素", () => {
    projection('<h1>主<span>标题</span><div>标题续</div>标题尾</h1><p>正文</p>', ["标题续", "标题尾", "正文"]);
    projection('<h1>  </h1><h2>章标题</h2><h3>小标题</h3>', ["小标题"]);
  });

  it("忽略 head/script/style/noscript/template/svg 整棵子树，不把其中同文计为正文", () => {
    const html = '<head><title>同文</title><style>同文</style></head><body><script>同文</script><noscript><p>同文</p></noscript><template><h1>假标题</h1><p>同文</p></template><svg><text>同文</text><foreignObject><p>同文</p></foreignObject></svg><h1>章</h1><p>同文</p><p>甲<script>干扰</script><svg><text>噪音</text></svg>乙</p></body>';
    const { doc, maps } = projection(html, ["同文", "甲乙"]);
    expect(maps[0].element).toBe(doc.querySelector("h1 + p"));
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    expect(doc.querySelector("template")!.content.querySelector("p")?.textContent).toBe("同文");
    const range = doc.createRange(); range.selectNodeContents(maps[1].element);
    expect(selectionFromEpubRange(range, maps)).toBeNull();
  });

  it("保留实体、内联节点、图片、MathML 和注释，不改写 DOM 或节点身份", () => {
    const html = '<p>&lt;x&gt; &amp;lt; &#x1f600;<em>重<!--注释-->点</em><img alt="非正文"><math><mi>x</mi><mn>2</mn></math></p>';
    const { doc, maps } = projection(html, ["<x> &lt; 😀重点x2"]);
    const original = doc.querySelector("em")!.firstChild;
    expect(maps[0].points.some(point => point.node === original)).toBe(true);
    expect(doc.querySelector("img")).not.toBeNull();
    expect(doc.querySelector("math")).not.toBeNull();
    expect(maps[0].points.every(point => point.node.ownerDocument === doc)).toBe(true);
  });

  it("空文档或只有标题/忽略内容没有映射", () => {
    expect(mapMobiDocument(fixture(""), chapter([]))).toEqual([]);
    expect(mapMobiDocument(fixture("<h1>章</h1><script>正文</script>"), chapter(["正文"]))).toEqual([]);
  });
});

describe("精确字符、重复数量和可见性核验", () => {
  it("相同正文按出现次序绑定各自段落", () => {
    const { doc, maps } = projection('<p>同文</p><p>间隔</p><p>同文</p>', ["同文", "间隔", "同文"]);
    const range = doc.createRange(); range.selectNodeContents(doc.querySelectorAll("p")[2]);
    expect(selectionFromEpubRange(range, maps)?.paragraphId).toBe("p2");
  });

  it.each(['<p>独立</p><p>重复</p>', '<p>重复</p><p>独立</p>'])("同文重复被移除后两者都不猜绑：%s", html => {
    const maps = mapMobiDocument(fixture(html), chapter(["重复", "独立", "重复"]));
    expect(maps.map(map => map.paragraph.id)).toEqual(["p1"]);
  });

  it("新增同文副本也拒绝整组，但不影响独立正文", () => {
    const maps = mapMobiDocument(fixture('<p>重复</p><p>重复</p><p>独立</p>'), chapter(["重复", "独立"]));
    expect(maps.map(map => map.paragraph.id)).toEqual(["p1"]);
  });

  it.each([
    ["甲乙", "乙甲"], ["前甲乙后", "甲乙"], ["甲乙", "甲丙"],
    ["甲乙", "甲 乙"], ["甲<br>乙", "甲乙"], ["甲，乙", "甲乙"], ["Ａ乙", "A乙"],
  ])("不以子串、乱序、去空格或标点等近似规则匹配 %s / %s", (html, text) => {
    expect(mapMobiDocument(fixture(`<p>${html}</p>`), chapter([text]))).toEqual([]);
  });

  it.each([
    [["甲", "乙"], ["乙", "甲"]],
    [["重复", "独立", "重复"], ["重复", "重复", "独立"]],
  ])("数量相同但段落序列重排时拒绝整章", (expected, actual) => {
    expect(mapMobiDocument(fixture(actual.map(text => `<p>${text}</p>`).join("")), chapter(expected))).toEqual([]);
  });

  it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"', 'style="content-visibility:hidden"'])("%s 内容计数但不可占用可见同文锚点", attribute => {
    const doc = fixture(`<div ${attribute}><p>重复</p></div><p>重复</p><p>独立</p>`);
    const maps = mapMobiDocument(doc, chapter(["重复", "重复", "独立"]));
    expect(maps.map(map => map.paragraph.id)).toEqual(["p1", "p2"]);
    expect(maps[0].element).toBe(doc.querySelectorAll("p")[1]);
    expect(mapMobiDocument(doc, chapter(["重复", "独立"])).map(map => map.paragraph.id)).toEqual(["p1"]);
  });

  it("相同文字仅藏于段内时不把隐藏点交给现有 Range 工具", () => {
    const doc = fixture('<p><span hidden>同文</span></p><p>同文</p><p>甲<span hidden>乙</span>丙</p>');
    const maps = mapMobiDocument(doc, chapter(["同文", "同文", "甲乙丙"]));
    expect(maps.map(map => map.paragraph.id)).toEqual(["p1"]);
    expect(rangeForEpubAnchor(maps, "p0", 0, 2)).toBeNull();
    expect(mapMobiDocument(doc, chapter(["甲丙"]))).toEqual([]);
  });

  it("计算 CSS 隐藏样式，尊重 visibility 子元素恢复可见", () => {
    document.head.innerHTML = '<style>.gone{display:none}.invisible{visibility:hidden}</style>';
    document.body.innerHTML = '<div class="gone"><p>重复</p></div><p>重复</p><div class="invisible"><p style="visibility:visible">恢复</p><p>隐藏</p></div>';
    const maps = mapMobiDocument(document, chapter(["重复", "重复", "恢复", "隐藏"]));
    expect(maps.map(map => map.paragraph.id)).toEqual(["p1", "p2"]);
  });

  it("首标题隐藏也只删除首标题，后续可见同名标题仍映射", () => {
    const doc = fixture('<h1 hidden>章</h1><h2>章</h2><p>正文</p>');
    const maps = mapMobiDocument(doc, chapter(["章", "正文"]));
    expect(maps.map(map => map.element.tagName)).toEqual(["H2", "P"]);
  });
});

describe("复用 EPUB 选区、分页锚点与 1000 字上限", () => {
  it("跨裸文本/嵌套段落的选区按正文顺序保留完整来源", () => {
    const { doc, maps } = projection('<div>甲乙<p>丙<em>丁</em></p>戊己</div>', ["甲乙", "丙丁", "戊己"]);
    const range = doc.createRange();
    range.setStart(maps[0].points[1].node, 1); range.setEnd(maps[2].points[0].node, 1);
    expect(selectionFromEpubRange(range, maps)).toEqual({
      version: 2, paragraphId: "p0", startOffset: 1, endOffset: 2, text: "乙\n\n丙丁\n\n戊",
      fragments: [
        { paragraphId: "p0", startOffset: 1, endOffset: 2, text: "乙" },
        { paragraphId: "p1", startOffset: 0, endOffset: 2, text: "丙丁" },
        { paragraphId: "p2", startOffset: 0, endOffset: 1, text: "戊" },
      ],
    });
    expect(anchorFromEpubRange(range, maps)).toEqual({ paragraphId: "p0", offset: 1 });
  });

  it("跨表格行与 br 选区保留抽取器生成的空格", () => {
    const { doc, maps } = projection('<table><tr><td>甲</td><td>乙<br>丙</td></tr><tr><td>丁</td><td>戊</td></tr></table>', ["甲 乙 丙", "丁 戊"]);
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector("table")!);
    expect(selectionFromEpubRange(range, maps)?.text).toBe("甲 乙 丙\n\n丁 戊");
  });

  it("未匹配或隐藏文字夹在映射段落间不能偷偷省略", () => {
    for (const middle of ['<p>不匹配</p>', '<p hidden>不匹配</p>']) {
      const doc = fixture(`<p>甲</p>${middle}<p>乙</p>`);
      const maps = mapMobiDocument(doc, chapter(["甲", "乙"]));
      const range = doc.createRange(); range.selectNodeContents(doc.body);
      expect(selectionFromEpubRange(range, maps)).toBeNull();
    }
  });

  it("分页定位保持段中 UTF-16 偏移且不越界", () => {
    const { maps } = projection('<p>一段😀长文字</p>', ["一段😀长文字"]);
    expect(anchorFromEpubRange(rangeForEpubAnchor(maps, "p0", 4, 7)!, maps)).toEqual({ paragraphId: "p0", offset: 4 });
    expect(rangeForEpubPosition(maps, "p0", 7)?.toString()).toBe("字");
    expect(rangeForEpubAnchor(maps, "p0", 4, 8)).toBeNull();
    expect(rangeForEpubAnchor(maps, "missing", 0, 1)).toBeNull();
    expect(rangeForEpubPosition(maps, "p0", -1)).toBeNull();
    expect(rangeForEpubPosition(maps, "p0", 8)).toBeNull();
  });

  it.each([false, true])("使用既有 cap 函数收紧实际跨段选区，反向=%s，不拆 emoji", reverse => {
    const texts = ["😀".repeat(600), "乙".repeat(600)];
    document.body.innerHTML = `<div>${texts[0]}<p>${texts[1]}</p></div>`;
    const maps = mapMobiDocument(document, chapter(texts));
    const range = document.createRange(); range.selectNodeContents(document.body);
    const full = selectionFromEpubRange(range, maps)!;
    const expected = capReadingSelection(full, reverse);
    const first = maps[0].points[0], last = maps[1].points[maps[1].points.length - 1];
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(reverse ? last.node : first.node, reverse ? last.offset + 1 : first.offset,
      reverse ? first.node : last.node, reverse ? first.offset : last.offset + 1);
    const onLimit = vi.fn();
    const limited = readLimitedEpubSelection(selection, maps, onLimit);
    expect(limited).toEqual(expected);
    expect(Array.from(limited!.text)).toHaveLength(1000);
    expect(selection.toString()).toBe(selectionParts(expected).map(part => part.text).join(""));
    expect(selectionFromEpubRange(selection.getRangeAt(0), maps)).toEqual(expected);
    expect(onLimit).toHaveBeenCalledOnce();
    expect(selectionParts(expected)[0].startOffset).toBe(reverse ? 404 : 0);
    expect(selectionParts(expected)[1].endOffset).toBe(reverse ? 600 : 398);
  });

  it("不超过上限时不触发裁剪回调", () => {
    document.body.innerHTML = '<p>正文</p>';
    const maps = mapMobiDocument(document, chapter(["正文"]));
    const range = document.createRange(); range.selectNodeContents(document.body);
    const selection = window.getSelection()!; selection.addRange(range);
    const onLimit = vi.fn();
    expect(readLimitedEpubSelection(selection, maps, onLimit)?.text).toBe("正文");
    expect(onLimit).not.toHaveBeenCalled();
  });
});
