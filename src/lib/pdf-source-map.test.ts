// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryBookContent, LibraryParagraph } from "./library";
import { bindPdfTextLayer, mapPdfDocument, pdfCompact, pdfRangesForSource, readLimitedPdfSelection, selectionFromPdfRange, type PdfDomPage, type PdfTextPage } from "./pdf-source-map";
import { countReadingCharacters } from "./reading-detail";
import { selectionParts } from "./reader-selection";

function book(texts: string[][], legacy = false): LibraryBookContent {
  return { id: "book", editionId: "edition", title: "合成PDF", author: "测试", chapters: texts.map((paragraphs, index) => ({
    id: `chapter-${index + 1}`, title: `页${index + 1}`, ...(legacy ? {} : { sourceHref: `pdf:page:${index + 1}` }),
    paragraphs: paragraphs.map((text, paragraph) => ({ id: `p${index + 1}-${paragraph + 1}`, text })),
  })) };
}
function page(pageNumber: number, strings: string[]): PdfTextPage {
  return { pageNumber, width: 600, height: 800, rotation: 0, mapped: false, runs: [], items: strings.map((str, index) => ({ str, transform: [1, 0, 0, 1, index * 10, 100], width: str.length * 10, height: 10 })) };
}
function mount(pages: readonly PdfTextPage[]) {
  const root = document.createElement("main"); document.body.append(root);
  const layers = pages.map(p => {
    const container = document.createElement("section"); root.append(container);
    const divs = p.items.map(item => { const div = document.createElement("span"); div.textContent = item.str; container.append(div); return div; });
    return { container, divs, dom: bindPdfTextLayer(p, container, divs, p.items.map(item => item.str)) };
  });
  return { root, layers, dom: layers.map(layer => layer.dom) };
}
function fixture(texts: string[][], strings = texts, legacy = false) {
  const canonical = book(texts, legacy), index = mapPdfDocument(strings.map((items, i) => page(i + 1, items)), canonical);
  return { canonical, ...index, ...mount(index.pages) };
}
function whole(node: Node): Range { const range = document.createRange(); range.selectNodeContents(node); return range; }
function nativeSelection(range: Range, reverse = false): Selection {
  const selection = window.getSelection()!; selection.removeAllRanges();
  selection.setBaseAndExtent(reverse ? range.endContainer : range.startContainer, reverse ? range.endOffset : range.startOffset, reverse ? range.startContainer : range.endContainer, reverse ? range.startOffset : range.endOffset);
  return selection;
}
function withBoundary(f: ReturnType<typeof fixture>, start: number, end: number): Range {
  const range = document.createRange(), first = f.dom[0].points[0], last = f.dom.at(-1)!.points.at(-1)!;
  range.setStart(first.node, start); range.setEnd(last.node, end); return range;
}
// WHY：只用合成正文和真实 jsdom Range，绝不读取用户书库、原文件或调用模型。
afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("PDF canonical 页级与旧版精确映射独立验收", () => {
  it("新 locator 按页归属而非重复文本首命中，保留输入与段落ID", () => {
    const canonical = book([["重复正文"], ["重复正文"]]), pages = [page(1, ["重复正文"]), page(2, ["重复正文"])], before = JSON.stringify({ canonical, pages });
    const mapped = mapPdfDocument(pages, canonical);
    expect(mapped.complete).toBe(true);
    expect(mapped.pages.map(p => p.runs[0].paragraphId)).toEqual(["p1-1", "p2-1"]);
    expect(JSON.stringify({ canonical, pages })).toBe(before);
    expect(mapped.paragraphs.map(p => p.id)).toEqual(["p1-1", "p2-1"]);
  });
  it("逐页非空白序列相等，允许 item 内外与 canonical 空白不同", () => {
    const mapped = mapPdfDocument([page(1, ["\t甲\n", "乙\u00a0丙"] )], book([["甲 乙\n丙"]]));
    expect(mapped.complete).toBe(true);
    expect(mapped.pages[0].runs.map(run => [run.itemIndex, run.itemStart, run.startOffset])).toEqual([[0, 1, 0], [1, 0, 2], [1, 2, 4]]);
  });
  it("同页多个 canonical 段落用顺序分配，不修改ID", () => {
    const mapped = mapPdfDocument([page(1, ["甲乙丙丁"])], book([["甲乙", "丙丁"]]));
    expect(mapped.pages[0].runs.map(run => [run.paragraphId, run.startOffset, run.endOffset])).toEqual([["p1-1", 0, 2], ["p1-2", 0, 2]]);
  });
  it("一个新页不匹配不会借用相邻页同文，也不影响正确页", () => {
    const result = mapPdfDocument([page(1, ["第二页"]), page(2, ["第二页"])], book([["第一页"], ["第二页"]]));
    expect(result.complete).toBe(false); expect(result.pages[0]).toMatchObject({ mapped: false, runs: [] }); expect(result.pages[1].mapped).toBe(true);
  });
  it("相同总文本但页边界不一致时不按整本 fallback", () => {
    const result = mapPdfDocument([page(1, ["甲乙丙"]), page(2, ["丁"])], book([["甲乙"], ["丙丁"]]));
    expect(result.pages.every(p => !p.mapped && p.runs.length === 0)).toBe(true);
  });
  it("空白页可展示但没有可伪造的来源 run", () => {
    const result = mapPdfDocument([page(1, [" \n"]), page(2, ["正文"])], book([[], ["正文"]]));
    expect(result.complete).toBe(true); expect(result.pages[0].runs).toEqual([]);
  });
  it("旧版整本文字精确对应时允许段落跨PDF页且保持旧ID", () => {
    const result = mapPdfDocument([page(1, ["甲乙"]), page(2, ["丙丁重复重复"])], book([["甲乙丙丁", "重复", "重复"]], true));
    expect(result.complete).toBe(true);
    expect(result.pages[1].runs.map(run => [run.paragraphId, run.startOffset, run.endOffset])).toEqual([["p1-1", 2, 4], ["p1-2", 0, 2], ["p1-3", 0, 2]]);
  });
  it.each(["甲乙重复", "甲乙重复重复多", "甲错重复重复", "重复重复甲乙"])("旧版整本不等 (%s) 时全部拒绝，不用局部同文猜测", text => {
    const result = mapPdfDocument([page(1, [text])], book([["甲乙", "重复", "重复"]], true));
    expect(result.complete).toBe(false); expect(result.pages.every(p => !p.mapped && p.runs.length === 0)).toBe(true);
  });
  it("缩放旋转只改变几何值，不改变 canonical 偏移", () => {
    const canonical = book([["甲😀乙 公式x<y"]]), source = page(1, ["甲😀乙", "公式x<y"]);
    const rotated = { ...source, width: 1600, height: 1200, rotation: 90, items: source.items.map(item => ({ ...item, transform: [0, 2, -2, 0, 600, 0], width: item.width * 2, height: 20 })) };
    expect(mapPdfDocument([rotated], canonical).pages[0].runs).toEqual(mapPdfDocument([source], canonical).pages[0].runs);
  });
});

describe("PDF TextLayer 绑定", () => {
  it("保留 UTF-16 偏移并跨嵌套 text node 绑定，忽略空 item", () => {
    const mapped = mapPdfDocument([page(1, ["甲😀乙", ""])], book([["甲😀乙"]])).pages[0];
    const container = document.createElement("div"), div = document.createElement("span"), em = document.createElement("em"), empty = document.createElement("span");
    div.append(document.createTextNode("甲")); em.textContent = "😀乙"; div.append(em); container.append(div, empty); document.body.append(container);
    const dom = bindPdfTextLayer(mapped, container, [div, empty], ["甲😀乙", ""]);
    expect(dom.points.map(p => p.sourceOffset)).toEqual([0, 1, 2, 3]);
    expect(dom.points.slice(1).map(p => p.offset)).toEqual([0, 1, 2]);
    expect(pdfRangesForSource([dom], { paragraphId: "p1-1", startOffset: 1, endOffset: 3 })[0].toString()).toBe("😀");
  });
  it.each(["dom", "strings", "whitespace"])("每 item 严格校验，拒绝 %s 差异", change => {
    const f = fixture([["甲 乙"]]), layer = f.layers[0], strings = ["甲 乙"];
    if (change === "dom") layer.divs[0].textContent = "甲 丙";
    if (change === "strings") strings[0] = "甲 丙";
    if (change === "whitespace") layer.divs[0].textContent = "甲乙";
    expect(() => bindPdfTextLayer(f.pages[0], layer.container, layer.divs, strings)).toThrow(/文字层.*不一致/);
  });
  it.each(["divs", "strings", "unmapped"])("%s 不完整时不给部分绑定", mode => {
    const f = fixture([["甲乙"]]);
    const result = bindPdfTextLayer({ ...f.pages[0], mapped: mode !== "unmapped" }, f.layers[0].container, mode === "divs" ? [] : f.layers[0].divs, mode === "strings" ? [] : ["甲乙"]);
    expect(result.points).toEqual([]);
  });
  it("不接受不属于声明 TextLayer 的节点，避免外部同文伪造来源", () => {
    const f = fixture([["甲乙"]]), alien = document.createElement("div"); document.body.append(alien);
    let points: PdfDomPage["points"] = [];
    try { points = bindPdfTextLayer(f.pages[0], alien, f.layers[0].divs, ["甲乙"]).points; } catch (error) { expect(error).toBeInstanceOf(Error); }
    expect(points).toEqual([]);
  });
});

describe("PDF Range 精确多段选区与来源反查", () => {
  it("跨页提取首尾局部和中间全部段，输入注册顺序不影响阅读顺序", () => {
    const f = fixture([["甲乙丙丁"], ["戊己庚辛"], ["壬癸子丑"]]), range = withBoundary(f, 1, 3);
    expect(selectionFromPdfRange(range, [...f.dom].reverse(), f.paragraphs)).toEqual({ paragraphId: "p1-1", startOffset: 1, endOffset: 4, version: 2, text: "乙丙丁\n\n戊己庚辛\n\n壬癸子", fragments: [
      { paragraphId: "p1-1", startOffset: 1, endOffset: 4, text: "乙丙丁" }, { paragraphId: "p2-1", startOffset: 0, endOffset: 4, text: "戊己庚辛" }, { paragraphId: "p3-1", startOffset: 0, endOffset: 3, text: "壬癸子" },
    ] });
  });
  it("跨 item 空白差异返回 canonical 原文而不是拼接PDF item", () => {
    const f = fixture([["甲 乙\n丙丁"]], [["甲\n", "乙", " 丙丁"]]);
    expect(selectionFromPdfRange(whole(f.root), f.dom, f.paragraphs)).toEqual({ paragraphId: "p1-1", startOffset: 0, endOffset: 6, text: "甲 乙\n丙丁" });
  });
  it("旧段落跨两页仍保留单段来源，反查得到两页 Range", () => {
    const canonical = book([["甲乙丙丁"]], true), index = mapPdfDocument([page(1, ["甲乙"]), page(2, ["丙丁"])], canonical), f = mount(index.pages);
    expect(selectionFromPdfRange(whole(f.root), f.dom, index.paragraphs)).toEqual({ paragraphId: "p1-1", startOffset: 0, endOffset: 4, text: "甲乙丙丁" });
    expect(pdfRangesForSource(f.dom, { paragraphId: "p1-1", startOffset: 1, endOffset: 3 }).map(range => range.toString())).toEqual(["乙", "丙"]);
    expect(pdfRangesForSource(f.dom, { paragraphId: "missing", startOffset: 0, endOffset: 1 })).toEqual([]);
  });
  it("同文第二段不会跳到第一段", () => {
    const f = fixture([["重复正文"], ["重复正文"]]);
    expect(selectionFromPdfRange(whole(f.layers[1].container), f.dom, f.paragraphs)?.paragraphId).toBe("p2-1");
  });
  it("折叠或纯空白 Range 不产生选文", () => {
    const f = fixture([["甲 乙"]]), range = document.createRange(), node = f.layers[0].divs[0].firstChild!;
    range.setStart(node, 1); range.setEnd(node, 1); expect(selectionFromPdfRange(range, f.dom, f.paragraphs)).toBeNull();
    range.setEnd(node, 2); expect(selectionFromPdfRange(range, f.dom, f.paragraphs)).toBeNull();
  });
  it.each([[1, 2], [2, 3]])("拒绝拆开代理对 UTF-16 边界 %s..%s", (start, end) => {
    const f = fixture([["甲😀乙"]]), range = withBoundary(f, start, end);
    expect(selectionFromPdfRange(range, f.dom, f.paragraphs)).toBeNull();
  });
  it("合法 emoji 来源偏移按 UTF-16 保存", () => {
    const f = fixture([["甲😀乙"]]); expect(selectionFromPdfRange(withBoundary(f, 1, 3), f.dom, f.paragraphs)).toMatchObject({ text: "😀", startOffset: 1, endOffset: 3 });
  });
  it("中间页未绑定时拒绝跨页选文，不掩盖缺失的段落", () => {
    const f = fixture([["甲乙"], ["丙丁"], ["戊己"]]);
    expect(selectionFromPdfRange(whole(f.root), [f.dom[0], f.dom[2]], f.paragraphs)).toBeNull();
  });
  it("中间空白页未注册时也拒绝跨页，不仅检查 canonical 字符相等", () => {
    const f = fixture([["甲乙"], [], ["丙丁"]]);
    expect(selectionFromPdfRange(whole(f.root), [f.dom[0], f.dom[2]], f.paragraphs)).toBeNull();
  });
  it("夹带未映射可见文字必须拒绝，不截掉额外文字后提交", () => {
    const f = fixture([["甲乙"]]), extra = document.createElement("span"); extra.textContent = "脚注伪造"; f.root.append(extra);
    expect(selectionFromPdfRange(whole(f.root), f.dom, f.paragraphs)).toBeNull();
  });
  it("绑定后的 TextLayer 篡改不能复用旧来源", () => {
    const f = fixture([["甲乙"]]); f.layers[0].divs[0].firstChild!.nodeValue = "甲丙";
    expect(selectionFromPdfRange(whole(f.root), f.dom, f.paragraphs)).toBeNull();
  });
  it("节点移出 TextLayer 后旧注册无效，不能把正文外同文当来源", () => {
    const f = fixture([["甲乙"]]), elsewhere = document.createElement("aside"); document.body.append(elsewhere); elsewhere.append(f.layers[0].divs[0]);
    expect(selectionFromPdfRange(whole(elsewhere), f.dom, f.paragraphs)).toBeNull();
  });
  it("DOM 页顺序与注册页序相反时不以重复文本掩盖乱序", () => {
    const f = fixture([["重复"], ["重复"]]); f.root.prepend(f.layers[1].container);
    expect(selectionFromPdfRange(whole(f.root), f.dom, f.paragraphs)).toBeNull();
  });
});

describe("PDF 1000 Unicode 硬上限同步可见DOM", () => {
  it.each([999, 1000])("%s字原样保留，不触发限长反馈", length => {
    const f = fixture([["甲".repeat(length)]]), selection = nativeSelection(whole(f.root)), notice = vi.fn();
    expect(readLimitedPdfSelection(selection, f.dom, f.paragraphs, notice)?.text).toBe("甲".repeat(length)); expect(notice).not.toHaveBeenCalled(); expect(selection.toString()).toHaveLength(length);
  });
  it.each([false, true])("1001字%s反向选取时，保留手势锚点一侧并同步实际Range", reverse => {
    const text = "起" + "甲".repeat(999) + "终", f = fixture([[text]]), range = withBoundary(f, 0, text.length), selection = nativeSelection(range, reverse), notice = vi.fn();
    const snapshot = readLimitedPdfSelection(selection, f.dom, f.paragraphs, notice)!;
    expect(snapshot.text).toBe(reverse ? text.slice(1) : text.slice(0, -1)); expect(countReadingCharacters(snapshot.text)).toBe(1000);
    expect(selection.toString()).toBe(snapshot.text); expect(selectionFromPdfRange(selection.getRangeAt(0), f.dom, f.paragraphs)).toEqual(snapshot); expect(notice).toHaveBeenCalledOnce();
    if (reverse) expect(selection.anchorOffset).toBe(text.length);
    readLimitedPdfSelection(selection, f.dom, f.paragraphs, notice); expect(notice).toHaveBeenCalledOnce();
  });
  it.each([false, true])("emoji上限按字符而非UTF-16，反向=%s", reverse => {
    const f = fixture([["😀".repeat(1001)]]), selection = nativeSelection(withBoundary(f, 0, 2002), reverse);
    const snapshot = readLimitedPdfSelection(selection, f.dom, f.paragraphs)!;
    expect(snapshot.text).toBe("😀".repeat(1000)); expect(snapshot.startOffset).toBe(reverse ? 2 : 0); expect(snapshot.endOffset).toBe(reverse ? 2002 : 2000);
    expect(selection.toString()).toBe(snapshot.text); expect(Array.from(selection.toString())).toHaveLength(1000);
  });
  it.each([false, true])("跨页多段上限含段间分隔符，反向=%s", reverse => {
    const f = fixture([["甲".repeat(600)], ["乙".repeat(600)]]), selection = nativeSelection(withBoundary(f, 0, 600), reverse);
    const snapshot = readLimitedPdfSelection(selection, f.dom, f.paragraphs)!;
    expect(countReadingCharacters(snapshot.text)).toBe(1000);
    expect(selectionParts(snapshot).map(part => part.text.length)).toEqual(reverse ? [398, 600] : [600, 398]);
    expect(pdfCompact(selection.toString())).toBe(pdfCompact(snapshot.text)); expect(selectionFromPdfRange(selection.getRangeAt(0), f.dom, f.paragraphs)).toEqual(snapshot);
  });
  it("跨item且 canonical 内有空白，限长后可见选区重新读取得到相同快照", () => {
    const text = "甲".repeat(600) + " " + "乙".repeat(600), f = fixture([[text]], [["甲".repeat(600), "乙".repeat(600)]]), selection = nativeSelection(whole(f.root));
    const snapshot = readLimitedPdfSelection(selection, f.dom, f.paragraphs)!;
    expect(countReadingCharacters(snapshot.text)).toBe(1000); expect(snapshot.endOffset).toBe(1000);
    expect(selectionFromPdfRange(selection.getRangeAt(0), f.dom, f.paragraphs)).toEqual(snapshot); expect(selection.toString()).toBe("甲".repeat(600) + "乙".repeat(399));
  });
  it("无可映射来源时不截断、回调或发送伪造选文", () => {
    const f = fixture([["甲乙"]]), selection = nativeSelection(whole(f.root)), notice = vi.fn();
    expect(readLimitedPdfSelection(selection, [], f.paragraphs, notice)).toBeNull(); expect(notice).not.toHaveBeenCalled(); expect(selection.toString()).toBe("甲乙");
  });
  it("空原生选区直接拒绝", () => {
    expect(readLimitedPdfSelection(window.getSelection()!, [], [] as LibraryParagraph[])).toBeNull();
  });
});

describe("PDF 选区生命周期补充验收", () => {
  it("中间空白页已注册则正常跨页，不能一律禁掉空白页", () => {
    const f = fixture([["甲乙"], [], ["丙丁"]]);
    expect(selectionFromPdfRange(whole(f.root), f.dom, f.paragraphs)?.text).toBe("甲乙\n\n丙丁");
  });
  it("版本切换暂留旧DOM时，没有当前段落ID的选区应拒绝而不是抛异常", () => {
    const f = fixture([["甲乙"]]);
    expect(selectionFromPdfRange(whole(f.root), f.dom, [{ id: "new-edition-paragraph", text: "甲乙" }])).toBeNull();
  });
  it("跨item拆开的代理对仍按同一个Unicode字符和准确UTF-16偏移识别", () => {
    const f = fixture([["甲😀乙"]], [["甲\ud83d", "\ude00乙"]]);
    const range = document.createRange(); range.setStart(f.layers[0].divs[0].firstChild!, 1); range.setEnd(f.layers[0].divs[1].firstChild!, 1);
    expect(selectionFromPdfRange(range, f.dom, f.paragraphs)).toEqual({ paragraphId: "p1-1", startOffset: 1, endOffset: 3, text: "😀" });
  });
  it.each([false, true])("限长恰好落在canonical空白时，快照必须与修改后的DOM Range一致，反向=%s", reverse => {
    const text = reverse ? "乙 " + "甲".repeat(999) : "甲".repeat(999) + " 乙";
    const f = fixture([[text]], [reverse ? ["乙", "甲".repeat(999)] : ["甲".repeat(999), "乙"]]);
    const range = document.createRange(), first = f.dom[0].points[0], last = f.dom[0].points.at(-1)!;
    range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
    const selection = nativeSelection(range, reverse), snapshot = readLimitedPdfSelection(selection, f.dom, f.paragraphs);
    expect(snapshot).not.toBeNull(); expect(countReadingCharacters(snapshot!.text)).toBeLessThanOrEqual(1000);
    expect(selectionFromPdfRange(selection.getRangeAt(0), f.dom, f.paragraphs)).toEqual(snapshot);
  });
});

describe("PDF.js 未挂载空 textDiv 的真实契约回归", () => {
  it("首中尾空item的span未挂载不阻断其它文字，item索引和跨item偏移不变", () => {
    const strings = ["", "甲😀", "", "乙丙", ""], f = fixture([["甲😀 乙丙"]], [strings]), layer = f.layers[0];
    for (const [index, div] of layer.divs.entries()) if (strings[index] === "") div.remove();
    const dom = bindPdfTextLayer(f.pages[0], layer.container, layer.divs, strings);
    expect(layer.container.children).toHaveLength(2); expect(layer.divs).toHaveLength(5);
    expect(dom.points.map(point => point.sourceOffset)).toEqual([0, 1, 2, 4, 5]);
    expect(dom.points.every(point => layer.container.contains(point.node))).toBe(true);
    expect(f.pages[0].runs.map(run => run.itemIndex)).toEqual([1, 3]);
    expect(selectionFromPdfRange(whole(layer.container), [dom], f.paragraphs)).toEqual({ paragraphId: "p1-1", startOffset: 0, endOffset: 6, text: "甲😀 乙丙" });
  });
  it("整页只有未挂载空item时可绑定但没有伪造来源", () => {
    const f = fixture([[]], [["", ""]]), layer = f.layers[0]; layer.divs.forEach(div => div.remove());
    const dom = bindPdfTextLayer(f.pages[0], layer.container, layer.divs, ["", ""]);
    expect(dom.points).toEqual([]); expect(selectionFromPdfRange(whole(layer.container), [dom], f.paragraphs)).toBeNull();
  });
  it.each(["乙", " ", "\n"])("空item豁免不会放过未挂载非空item (%j)，整页拒绝部分绑定", extra => {
    const f = fixture([["甲乙"]], [["", "甲", extra, "乙"]]);
    // WHY：用同一页全量精确对齐建立来源后再脱离节点，避免测试因原始文本不等而误通过。
    const canonical = book([[`甲${extra}乙`]]), mapped = mapPdfDocument([page(1, ["", "甲", extra, "乙"])], canonical).pages[0], layer = f.layers[0];
    expect(mapped.mapped).toBe(true); layer.divs[0].remove(); layer.divs[2].remove();
    expect(bindPdfTextLayer(mapped, layer.container, layer.divs, ["", "甲", extra, "乙"]).points).toEqual([]);
  });
  it.each(["dom", "strings"])("空item的%s被注入字符仍拒绝，不因为未挂载而跳过一致性核验", target => {
    const f = fixture([["甲乙"]], [["", "甲乙"]]), layer = f.layers[0], strings = ["", "甲乙"];
    layer.divs[0].remove();
    if (target === "dom") layer.divs[0].textContent = "注入";
    else strings[0] = "注入";
    expect(() => bindPdfTextLayer(f.pages[0], layer.container, layer.divs, strings)).toThrow(/文字层.*不一致/);
  });
});
