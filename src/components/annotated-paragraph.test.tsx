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

  it("句末图标展示历史；点击完整句读才调用装配回调", () => {
    const older = { ...annotation, id: "a2", summary: "第一次解释", createdAt: "2026-09-13" };
    render({ annotations: [older, annotation] }); hover(element(".judu-history-marker"));
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
    render(); const marker = element(".judu-history-marker"); act(() => marker.focus());
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
      expect(getComputedStyle(element(".judu-concept-term")).fontWeight).toBe("650");
      expect(getComputedStyle(element(".judu-annotation-text")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(css).toContain("text-decoration-style: dashed"); expect(css).toContain("font-weight: 650"); expect(css).not.toMatch(/.judu-annotated-paragraphs*{/);
    } finally { style.remove(); }
  });
});


describe("AnnotatedParagraph 全书字典概念", () => {
  const bookConcepts = [{ name: "自我意识", text: "本书保存的逐词定义" }] as const;

  it("无 annotation 的段落也显示全部字典命中，且不生成句读标记", () => {
    const text = "自我意识面对自我意识；自我意识成立。";
    render({ text, sourceText: text, annotations: [], bookConcepts });
    const terms = Array.from(document.querySelectorAll<HTMLElement>(".judu-concept-term"));
    expect(terms).toHaveLength(3); expect(element("p").textContent).toBe(text);
    expect(document.querySelector(".judu-history-marker, .judu-annotation-text")).toBeNull();
    for (const term of terms) {
      hover(term); expect(element('[role="dialog"]').textContent).toContain("本书保存的逐词定义");
      expect(element('[role="dialog"]').textContent).not.toContain(annotation.summary);
    }
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("跨页词两侧均可点击同词定义，UTF-16 文本偏移保持原段坐标", () => {
    const full = "前😀自我意识成立";
    render({ text: full.slice(0, 5), sourceText: full, sourceStartOffset: 0, sourceEndOffset: 5, annotations: [], bookConcepts });
    expect(element(".judu-concept-term").textContent).toBe("自我");
    click(element(".judu-concept-term")); expect(element('[data-concept-definition="自我意识"]').textContent).toBe("本书保存的逐词定义");
    render({ text: full.slice(5), sourceText: full, sourceStartOffset: 5, sourceEndOffset: full.length, annotations: [], bookConcepts });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const term = element(".judu-concept-term"); expect(term.textContent).toBe("意识"); expect(term.dataset.conceptWord).toBe("自我意识");
    expect(term.closest<HTMLElement>("[data-reader-text]")?.dataset.sourceStart).toBe("5");
    expect(term.closest<HTMLElement>("[data-reader-text]")?.dataset.sourceEnd).toBe("7");
    act(() => term.focus()); expect(element('[data-concept-definition="自我意识"]').textContent).toBe("本书保存的逐词定义");
    click(term); expect(element('[role="dialog"]').textContent).not.toContain("句读历史");
    expect(element("p").textContent).toBe(full.slice(5));
  });

  it("原文没有确切名称时不渲染概念词或弹窗，不拆复合名称", () => {
    const text = "确定性还须提高为真理性。";
    render({ text, sourceText: text, annotations: [], bookConcepts: [{ name: "确定性与真理性", text: "两者关系" }, { name: "对象与主体的统一", text: "抽象表达" }] });
    hover(element("p")); expect(document.querySelector(".judu-concept-term")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(element("p").textContent).toBe(text);
  });

  it("本段定义优先，书级定义补充去重；旧 annotation 可由字典补齐", () => {
    render({ bookConcepts: [{ name: "自我意识", text: "意识以自身作为对象" }, ...bookConcepts, ...bookConcepts] });
    click(element(".judu-concept-term"));
    expect(Array.from(document.querySelectorAll(".judu-concept-definition > div")).map((item) => item.textContent)).toEqual(["意识以自身作为对象", "本书保存的逐词定义"]);
    render({ annotations: [{ ...annotation, conceptDetails: undefined }], bookConcepts });
    expect(element(".judu-concept-definition").textContent).toBe("本书保存的逐词定义");
    expect(element(".judu-concept-definition").textContent).not.toContain(annotation.summary);
  });

  it("书级名称已命中但无定义时显示暂无定义", () => {
    render({ annotations: [], bookConcepts: [{ name: "自我意识", text: "" }] });
    click(element(".judu-concept-term")); expect(element(".judu-concept-definition").textContent).toBe("暂无定义");
  });

  it("字典刷新实时更新已打开定义，移除概念时关闭旧浮层", () => {
    render({ annotations: [], bookConcepts }); click(element(".judu-concept-term"));
    render({ annotations: [], bookConcepts: [{ name: "自我意识", text: "刷新后的词义" }] });
    expect(element(".judu-concept-definition").textContent).toBe("刷新后的词义");
    render({ annotations: [], bookConcepts: [] });
    expect(document.querySelector(".judu-concept-term")).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("关闭概念显示后书级字典也不能留下词语标记", () => {
    render({ annotations: [], bookConcepts }); click(element(".judu-concept-term"));
    render({ annotations: [], bookConcepts, showConcepts: false });
    expect(document.querySelector(".judu-concept-term")).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
