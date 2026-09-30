// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotatedParagraph } from "./annotated-paragraph";
import type { TextAnnotation } from "../lib/annotations";

const annotation: TextAnnotation = { id: "a1", paragraphId: "p1", startOffset: 0, endOffset: 6, textHash: "h", threadId: "t", summary: "整段句读摘要，不是概念定义", concepts: ["自我意识"], conceptDetails: [{ name: "自我意识", text: "意识以自身作为对象" }], createdAt: "2026-09-14T03:00:00Z" };
const source = "自我意识成立";
let host: HTMLDivElement;
let root: Root;
const onOpen = vi.fn();
const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } });
function element(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error("找不到组件节点：" + selector);
  return node;
}
const hover = (node: HTMLElement) => act(() => { node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
const click = (node: HTMLElement) => act(() => { node.click(); });
function render(overrides: Partial<React.ComponentProps<typeof AnnotatedParagraph>> = {}) {
  act(() => root.render(<article className="reading-pane"><div className="reading-content"><AnnotatedParagraph paragraphId="p1" text={source} annotations={[annotation]} showConcepts onOpenAnnotation={onOpen} {...overrides} /></div></article>));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("reading-pane")) return rect(200, 60, 700, 700);
    if (this.classList.contains("reading-content")) return rect(200, 100, 700, 600);
    if (this.matches("p")) return rect(260, 180, 260, 120);
    if (this.getAttribute("role") === "dialog") return rect(0, 0, 300, 200);
    return rect(350, 200, 18, 18);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); onOpen.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("AnnotatedParagraph 实测组件交互", () => {
  it("SSR 仅包含原文、逐词概念入口和无文字的句末 SVG，不提前渲染浮层", () => {
    const html = renderToStaticMarkup(<AnnotatedParagraph paragraphId="p1" text={source} annotations={[annotation]} showConcepts onOpenAnnotation={onOpen} />);
    expect(html).not.toContain('role="dialog"'); expect(html).not.toContain(annotation.summary);
    expect(html).toContain('data-source-start="0"'); expect(html).toContain('data-source-end="6"');
    expect(html).toContain("<svg"); expect(html).not.toContain("<b>"); expect(html).not.toContain("<strong>");
  });

  it("正文仅下划线，hover/click 正文不展示句读历史", () => {
    render({ showConcepts: false });
    const prose = element(".judu-annotation-text"); hover(prose); click(prose);
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(onOpen).not.toHaveBeenCalled();
    expect(element("p").textContent).toBe(source);
    expect(prose.getAttribute("tabindex")).toBeNull();
    expect(element("p").dataset.showAnalysisHints).toBe("true");
    expect(document.querySelector(".reading-annotation, .concept-mark, .annotation-popover")).toBeNull();
  });

  it("active 仅通过 data-active-source 交给正文装配高亮", () => {
    render({ active: true }); expect(element("p").dataset.activeSource).toBe("true");
    expect(element(".judu-history-marker").hasAttribute("data-reader-decoration")).toBe(true);
    render({ active: false }); expect(element("p").dataset.activeSource).toBe("false");
  });

  it("概念 hover 仅展示逐词定义，portal 位于正文之外", () => {
    render(); hover(element(".judu-concept-term"));
    const dialog = element('[role="dialog"]');
    expect(dialog.textContent).toContain("意识以自身作为对象");
    expect(dialog.textContent).not.toContain(annotation.summary);
    expect(dialog.parentElement).toBe(document.body); expect(element("p").contains(dialog)).toBe(false);
    expect(onOpen).not.toHaveBeenCalled(); expect(dialog.hasAttribute("data-reader-decoration")).toBe(true);
  });

  it("旧概念只有名称显示暂无定义，绝不显示整段摘要", () => {
    render({ annotations: [{ ...annotation, conceptDetails: undefined }] }); click(element(".judu-concept-term"));
    expect(element('[role="dialog"]').textContent).toContain("暂无定义");
    expect(element('[role="dialog"]').textContent).not.toContain(annotation.summary);
  });

  it("历史标符悬停或聚焦不显示，点击才打开", () => {
    render(); const marker = element(".judu-history-marker");
    hover(marker); act(() => marker.focus());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(marker); expect(element('[role="dialog"]').textContent).toContain("句读历史");
  });
  it("句末图标展示历史；点击完整句读才调用装配回调", () => {
    const older = { ...annotation, id: "a2", summary: "第一次解释", createdAt: "2026-09-13" };
    render({ annotations: [older, annotation] }); click(element(".judu-history-marker"));
    expect(element('[role="dialog"]').textContent).toContain("句读历史");
    expect(element('[role="dialog"]').textContent).toContain("第一次解释");
    expect(document.querySelectorAll(".judu-history-marker")).toHaveLength(1);
    expect(document.querySelectorAll(".judu-annotation-history li")).toHaveLength(2);
    expect(onOpen).not.toHaveBeenCalled(); click(element(".judu-annotation-history button"));
    expect(onOpen).toHaveBeenCalledWith(annotation); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("概念 focus/Enter 和图标 click 相互独立，Escape 关闭", () => {
    render(); const term = element(".judu-concept-term");
    act(() => term.focus()); expect(element('[role="dialog"]').textContent).toContain("意识以自身作为对象");
    act(() => term.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(element(".judu-history-marker")); expect(element('[role="dialog"]').textContent).toContain(annotation.summary);
  });

  it("Escape 从浮层归还触发点焦点，不会被 onFocus 立即重新打开", () => {
    render(); const marker = element(".judu-history-marker"); act(() => marker.focus()); click(marker);
    act(() => marker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(element('[aria-label="关闭浮层"]'));
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(marker); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("分页片段只在原文选段真正结束时带图标，跨页继续片段不伪造末尾", () => {
    const full = "前😀自我意识成立后";
    const range = { ...annotation, startOffset: 3, endOffset: 9 };
    render({ text: full.slice(0, 7), sourceStartOffset: 0, sourceEndOffset: 7, annotations: [range] });
    expect(document.querySelector(".judu-history-marker")).toBeNull();
    render({ text: full.slice(7), sourceStartOffset: 7, sourceEndOffset: full.length, annotations: [range] });
    expect(element(".judu-history-marker").dataset.annotationEnd).toBe("9");
    expect(element("p").dataset.sourceStart).toBe("7"); expect(element("p").textContent).toBe(full.slice(7));
    expect(Array.from(document.querySelectorAll("[data-reader-text]")).map((node) => node.textContent).join("")).toBe(full.slice(7));
  });

  it("重叠范围保留不同结束点及其历史，不重复原文", () => {
    render({ annotations: [annotation, { ...annotation, id: "overlap", startOffset: 2, endOffset: 5, summary: "重叠句读" }] });
    expect(element("p").textContent).toBe(source);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".judu-history-marker")).map((node) => node.dataset.annotationEnd)).toEqual(["5", "6"]);
    click(element('[data-annotation-end="5"]')); expect(element('[role="dialog"]').textContent).toContain("重叠句读");
    expect(element('[role="dialog"]').textContent).not.toContain(annotation.summary);
  });

  it("换页或关闭概念开关时旧浮层不残留", () => {
    render(); hover(element(".judu-concept-term")); render({ showConcepts: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    render(); hover(element(".judu-history-marker"));
    render({ paragraphId: "other", text: "另页内容" }); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("独立 CSS 不改变正文尺寸：标记零宽零高、按钮绝对定位、概念不加粗", async () => {
    const css = await readFile(path.resolve("src/components/annotation-popover.css"), "utf8");
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    try {
      render();
      const marker = getComputedStyle(element(".judu-history-marker"));
      const anchor = getComputedStyle(element(".judu-history-anchor"));
      expect(marker.position).toBe("absolute"); expect(anchor.width).toBe("0px"); expect(anchor.height).toBe("0px");
      expect(element(".judu-history-anchor").textContent).toBe("");
      expect(getComputedStyle(element(".judu-concept-term")).fontWeight).toBe("normal");
      expect(getComputedStyle(element(".judu-annotation-text")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(css).toContain("text-decoration: underline solid rgb"); expect(css).not.toContain("text-decoration-style: dashed"); expect(css).toContain("data-show-analysis-hints"); expect(css).toContain("font-weight: inherit"); expect(css).not.toMatch(/.judu-annotated-paragraphs*{/);
    } finally { style.remove(); }
  });
});


describe("AnnotatedParagraph \u672c\u6bb5\u53e5\u8bfb\u6982\u5ff5", () => {
  const bookConcepts = [{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u672c\u4e66\u4fdd\u5b58\u7684\u9010\u8bcd\u5b9a\u4e49" }] as const;
  const local = (text: string, startOffset = 0, endOffset = text.length, definition = "\u672c\u6bb5\u5b9a\u4e49"): TextAnnotation => ({ ...annotation, paragraphId: "p1", startOffset, endOffset, concepts: ["\u81ea\u6211\u610f\u8bc6"], conceptDetails: [{ name: "\u81ea\u6211\u610f\u8bc6", text: definition }] });

  it("book dictionary alone does not create concept marks", () => {
    const text = "\u81ea\u6211\u610f\u8bc6\u9762\u5bf9\u81ea\u6211\u610f\u8bc6\uff1b\u81ea\u6211\u610f\u8bc6\u6210\u7acb\u3002";
    render({ text, sourceText: text, annotations: [], bookConcepts });
    expect(document.querySelectorAll(".judu-concept-term")).toHaveLength(0);
    expect(element("p").textContent).toBe(text);
    expect(document.querySelector(".judu-history-marker, .judu-annotation-text")).toBeNull();
  });

  it("same-name occurrences outside this paragraph annotation are not highlighted", () => {
    const text = "\u81ea\u6211\u610f\u8bc6\u9762\u5bf9\u81ea\u6211\u610f\u8bc6\uff1b\u81ea\u6211\u610f\u8bc6\u6210\u7acb\u3002";
    render({ text, sourceText: text, annotations: [local(text, 0, 4)], bookConcepts });
    const terms = document.querySelectorAll<HTMLElement>(".judu-concept-term");
    expect(terms).toHaveLength(1);
    expect(terms[0].textContent).toBe("\u81ea\u6211\u610f\u8bc6");
    hover(terms[0]);
    expect(element('[role="dialog"]').textContent).toContain("\u672c\u6bb5\u5b9a\u4e49");
    expect(element("p").textContent).toBe(text);
  });

  it("a concept crossing pagination retains its local definition and original offsets", () => {
    const full = "\u524d\ud83d\ude00\u81ea\u6211\u610f\u8bc6\u6210\u7acb";
    const annotationForFull = local(full, 3, 7);
    render({ text: full.slice(0, 5), sourceText: full, sourceStartOffset: 0, sourceEndOffset: 5, annotations: [annotationForFull], bookConcepts });
    expect(element(".judu-concept-term").textContent).toBe("\u81ea\u6211");
    click(element(".judu-concept-term"));
    expect(element('[data-concept-definition="\u81ea\u6211\u610f\u8bc6"]').textContent).toContain("\u672c\u6bb5\u5b9a\u4e49");
    render({ text: full.slice(5), sourceText: full, sourceStartOffset: 5, sourceEndOffset: full.length, annotations: [annotationForFull], bookConcepts });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const term = element(".judu-concept-term");
    expect(term.textContent).toBe("\u610f\u8bc6");
    expect(term.closest<HTMLElement>("[data-reader-text]")?.dataset.sourceStart).toBe("5");
    expect(term.closest<HTMLElement>("[data-reader-text]")?.dataset.sourceEnd).toBe("7");
    act(() => term.focus());
    expect(element('[data-concept-definition="\u81ea\u6211\u610f\u8bc6"]').textContent).toContain("\u672c\u6bb5\u5b9a\u4e49");
    expect(element("p").textContent).toBe(full.slice(5));
  });

  it("concept labels that do not literally occur in the source are not rendered", () => {
    const text = "\u786e\u5b9a\u6027\u8fd8\u987b\u63d0\u9ad8\u4e3a\u771f\u7406\u6027\u3002";
    const unrelated: TextAnnotation = { ...annotation, startOffset: 0, endOffset: text.length, concepts: ["\u786e\u5b9a\u6027\u4e0e\u771f\u7406\u6027"], conceptDetails: [{ name: "\u786e\u5b9a\u6027\u4e0e\u771f\u7406\u6027", text: "\u8bf4\u660e" }] };
    render({ text, sourceText: text, annotations: [unrelated], bookConcepts: [{ name: "\u786e\u5b9a\u6027\u4e0e\u771f\u7406\u6027", text: "\u4e24\u8005\u5173\u7cfb" }] });
    hover(element("p"));
    expect(document.querySelector(".judu-concept-term, [role=\"dialog\"]")).toBeNull();
    expect(element("p").textContent).toBe(text);
  });

  it("local definition wins and the book dictionary only supplements it without duplicates", () => {
    render({ bookConcepts: [{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u610f\u8bc6\u4ee5\u81ea\u8eab\u4f5c\u4e3a\u5bf9\u8c61" }, ...bookConcepts, ...bookConcepts] });
    click(element(".judu-concept-term"));
    expect(Array.from(document.querySelectorAll(".judu-concept-definition > div")).map((item) => item.textContent)).toEqual(["\u610f\u8bc6\u4ee5\u81ea\u8eab\u4f5c\u4e3a\u5bf9\u8c61", "\u672c\u4e66\u4fdd\u5b58\u7684\u9010\u8bcd\u5b9a\u4e49"]);
    render({ annotations: [{ ...annotation, conceptDetails: undefined }], bookConcepts });
    expect(element(".judu-concept-definition").textContent).toBe("\u672c\u4e66\u4fdd\u5b58\u7684\u9010\u8bcd\u5b9a\u4e49");
    expect(element(".judu-concept-definition").textContent).not.toContain(annotation.summary);
  });

  it("a scoped concept with no available definition shows the empty-state text", () => {
    render({ annotations: [{ ...annotation, concepts: ["\u81ea\u6211\u610f\u8bc6"], conceptDetails: undefined }], bookConcepts: [{ name: "\u81ea\u6211\u610f\u8bc6", text: "" }] });
    click(element(".judu-concept-term"));
    expect(element(".judu-concept-definition").textContent).toBe("\u6682\u65e0\u5b9a\u4e49");
  });

  it("definition updates live and the popup closes when its local annotation is removed", () => {
    const current = { ...annotation, conceptDetails: undefined };
    render({ annotations: [current], bookConcepts }); click(element(".judu-concept-term"));
    render({ annotations: [current], bookConcepts: [{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u5237\u65b0\u540e\u7684\u8bcd\u4e49" }] });
    expect(element(".judu-concept-definition").textContent).toBe("\u5237\u65b0\u540e\u7684\u8bcd\u4e49");
    render({ annotations: [], bookConcepts: [] });
    expect(document.querySelector(".judu-concept-term, [role=\"dialog\"]")).toBeNull();
  });

  it("disabling concept display removes its marks and popup", () => {
    render(); click(element(".judu-concept-term"));
    render({ showConcepts: false });
    expect(document.querySelector(".judu-concept-term, [role=\"dialog\"]")).toBeNull();
  });
});

describe("句读线模式", () => {
  it("开关仅控制句读线，不隐藏历史入口与概念", () => {
    render({showAnalysisHints:false, analysisHintOpacity:.22});
    expect(element('p').dataset.showAnalysisHints).toBe('false');
    expect(element('p').style.getPropertyValue('--analysis-hint-opacity')).toBe('0.22');
    expect(element('.judu-history-marker')).toBeTruthy();
    expect(element('.judu-concept-term')).toBeTruthy();
    expect(element('.judu-annotation-text.judu-has-concept')).toBeTruthy();
  });
});

it("页内重复概念是普通文字，不再包含弹窗入口", () => {
 const html=renderToStaticMarkup(<AnnotatedParagraph paragraphId="p" text="理性与理性" annotations={[{...annotation,paragraphId:"p",startOffset:0,endOffset:5,concepts:["\u7406\u6027"],conceptDetails:[{name:"\u7406\u6027",text:"\u5b9a\u4e49"}]}]} showConcepts bookConcepts={[{name:"理性",text:"定义"}]} highlightedConceptStarts={new Set([0])} onOpenAnnotation={()=>{}}/>);
 const node=document.createElement("div");node.innerHTML=html;
 const terms=node.querySelectorAll('[data-concept-word="理性"]');
 expect(terms).toHaveLength(1);expect(terms[0].getAttribute("role")).toBe("button");expect(node.textContent).toBe("理性与理性");
 expect(node.querySelectorAll('[aria-label="查看概念：理性"]')).toHaveLength(1);
});

it("首次概念与重复词均保留底层句读标记，重复词不加粗或生成入口", async()=>{
 const css=await readFile(path.resolve("src/components/annotation-popover.css"),"utf8");
 const style=document.createElement("style");style.textContent=css;document.head.append(style);
 try{
  render({paragraphId:"p",text:"理性与理性。",sourceText:"理性与理性。",bookConcepts:[{name:"理性",text:"定义"}],highlightedConceptStarts:new Set([0]),annotations:[{...annotation,paragraphId:"p",startOffset:0,endOffset:6,concepts:["\u7406\u6027"],conceptDetails:[{name:"\u7406\u6027",text:"\u5b9a\u4e49"}]}]});
  const spans=host.querySelectorAll<HTMLElement>('[data-reader-text]');
  const repeat=[...spans].find(span=>span.dataset.sourceStart==="3")!;
  expect(repeat.textContent).toBe("理性");expect(repeat.classList.contains("judu-annotation-text")).toBe(true);
  expect(repeat.querySelector('[role="button"]')).toBeNull();
  expect(css).not.toContain('.judu-annotation-text:not(.judu-has-concept)');
  expect(getComputedStyle(repeat).textDecoration).toContain("underline");
  expect(host.querySelectorAll('[data-concept-word="理性"]')).toHaveLength(1);
 }finally{style.remove();}
});

it("同次多段句读只在终点显示历史入口，前段保留下横线",()=>{
 const items=[{...annotation,id:"part-1",paragraphId:"p1",messageId:"m",startOffset:0,endOffset:3},{...annotation,id:"part-2",paragraphId:"p2",messageId:"m",startOffset:0,endOffset:3}];
 const ids=new Set(["part-2"]);
 const first=renderToStaticMarkup(<AnnotatedParagraph paragraphId="p1" text="第一段" annotations={items} historyMarkerIds={ids} showConcepts={false} onOpenAnnotation={()=>{}}/>);
 const last=renderToStaticMarkup(<AnnotatedParagraph paragraphId="p2" text="第二段" annotations={items} historyMarkerIds={ids} showConcepts={false} onOpenAnnotation={()=>{}}/>);
 expect(first).not.toContain('class="judu-history-marker"');expect(first).toContain("judu-annotation-text");
 expect(last).toContain('class="judu-history-marker"');expect(last).toContain("第二段");
});
