// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { IPDFLinkService } from "pdfjs-dist/types/web/interfaces";
import type { PdfRuntime } from "@/lib/pdf-loader";
import type { PdfDomPage, PdfTextPage } from "@/lib/pdf-source-map";
import { PdfPage } from "./pdf-page";

type Props = ComponentProps<typeof PdfPage>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const viewport = { width: 600, height: 800, clone: vi.fn(() => ({ width: 600, height: 800, dontFlip: true })) };
  const canvasTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = {
    rotate: 0, userUnit: 1, getViewport: vi.fn(() => viewport), render: vi.fn(() => canvasTask),
    getTextContent: vi.fn(async () => ({ items: [{ str: "第一段正文😀" }], styles: {} })),
    getAnnotations: vi.fn(async (): Promise<unknown[]> => []), cleanup: vi.fn(),
  };
  const documentProxy = { getPage: vi.fn(async () => page), annotationStorage: { sentinel: "storage" } };
  const textLayers: TextLayer[] = [];
  const annotationLayers: AnnotationLayer[] = [];
  const textGate = vi.fn(async () => {}); const detachedText = new Set<number>();
  const annotationGate = vi.fn(async () => {});
  type TextOptions = { container: HTMLElement; viewport: unknown; textContentSource: { items: { str: string }[]; styles: object } };
  type AnnotationOptions = { div: HTMLElement; [name: string]: unknown };
  class TextLayer {
    textDivs: HTMLElement[] = [];
    textContentItemsStr: string[];
    cancel = vi.fn();
    constructor(readonly options: TextOptions) { this.textContentItemsStr = options.textContentSource.items.map(item => item.str); textLayers.push(this); }
    render = vi.fn(async () => {
      this.textDivs = this.textContentItemsStr.map((str, index) => {
        const span = window.document.createElement("span"); span.textContent = str;
        if (str && !detachedText.has(index)) this.options.container.append(span); return span;
      }); await textGate();
    });
  }
  class AnnotationLayer {
    constructor(readonly options: AnnotationOptions) { annotationLayers.push(this); }
    render = vi.fn(async (params: Record<string, unknown>) => {
      await annotationGate();
      const link = window.document.createElement("a"); link.textContent = "受控批注";
      this.options.div.style.width = "600px"; this.options.div.dataset.mainRotation = "90";
      this.options.div.append(link); return params;
    });
  }
  const AnnotationType = { LINK: 2, TEXT: 1, POPUP: 16, HIGHLIGHT: 9, UNDERLINE: 10, STRIKEOUT: 12, SQUIGGLY: 11, FILEATTACHMENT: 17, WIDGET: 20, SCREEN: 15 };
  const xfa = { render: vi.fn() };
  const runtime = { TextLayer, AnnotationLayer, XfaLayer: xfa, AnnotationType, AnnotationMode: { ENABLE: 1 } } as unknown as PdfRuntime;
  const source: PdfTextPage = { pageNumber: 3, width: 600, height: 800, rotation: 0, mapped: true,
    items: [{ str: "第一段正文😀", transform: [1, 0, 0, 1, 0, 0], width: 80, height: 12 }],
    runs: [{ itemIndex: 0, itemStart: 0, itemEnd: 7, paragraphId: "p3", startOffset: 0, endOffset: 7 }] };
  return { viewport, canvasTask, page, documentProxy, runtime, source, textLayers, annotationLayers, textGate, annotationGate, AnnotationType, detachedText, xfa };
}
let h: ReturnType<typeof harness>, host: HTMLDivElement, root: Root, props: Props, mounted: boolean;
async function render(next: Partial<Props> = {}) { props = { ...props, ...next }; await act(async () => root.render(<PdfPage {...props} />)); }
async function unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("组件验收禁止联网"); }));
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1);
  h = harness(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounted = true;
  props = { document: h.documentProxy as unknown as PDFDocumentProxy, runtime: h.runtime, page: h.source,
    scale: 1, rotation: 0, linkService: {} as IPDFLinkService, onReady: vi.fn(), onRemove: vi.fn() };
});
afterEach(async () => { await unmount(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PdfPage 真实组件装配与安全边界", () => {
  it("装配 Canvas/TextLayer/AnnotationLayer 并发布真实字符映射", async () => {
    await render(); expect(h.documentProxy.getPage).toHaveBeenCalledWith(3);
    const canvas = host.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([600, 800]);
    expect(h.page.render).toHaveBeenCalledWith(expect.objectContaining({ canvas, viewport: h.viewport, annotationMode: 1 }));
    expect(h.textLayers[0].options.textContentSource).toEqual(await h.page.getTextContent());
    expect(h.textLayers[0].options.container).toBe(host.querySelector(".textLayer"));
    // WHY：断言最终图层行为，不要求异步批注直接写展示节点；允许安全staging方案。
    expect(host.querySelector(".annotationLayer")?.textContent).toBe("受控批注");
    expect(props.onReady).toHaveBeenCalledOnce();
    const mapped = vi.mocked(props.onReady).mock.calls[0][0];
    expect(mapped.pageNumber).toBe(3); expect(mapped.points).toHaveLength(7);
    expect(mapped.points.map(point => point.node.data[point.offset]).join("")).toBe("第一段正文😀");
    expect(mapped.points.every(point => point.paragraphId === "p3")).toBe(true);
    expect(host.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("false"); expect(fetch).not.toHaveBeenCalled();
  });
  it("禁止表单和脚本，批注层共享受控 linkService 与存储", async () => {
    await render(); const layer = h.annotationLayers[0];
    expect(layer.options).toMatchObject({ linkService: props.linkService, annotationStorage: h.documentProxy.annotationStorage });
    expect(layer.render).toHaveBeenCalledWith(expect.objectContaining({ renderForms: false, enableScripting: false, hasJSActions: false,
      linkService: props.linkService, imageResourcesPath: "/vendor/pdfjs/images/" }));
    expect(h.viewport.clone).toHaveBeenCalledWith({ dontFlip: true });
    expect(host.querySelector(".xfaLayer,form,input,script")).toBeNull(); expect(h.xfa.render).not.toHaveBeenCalled();
  });
  it("只允许链接及阅读批注，过滤附件、Widget、Screen 和异常条目", async () => {
    const safe = [1, 2, 16, 9, 10, 12, 11].map(annotationType => ({ annotationType }));
    h.page.getAnnotations.mockResolvedValue([...safe, { annotationType: 17, file: "secret" }, { annotationType: 20 },
      { annotationType: 15 }, { annotationType: "2" }, { annotationType: 999 }, null, "link", {}]);
    await render(); expect(h.page.getAnnotations).toHaveBeenCalledWith({ intent: "display" });
    expect(h.annotationLayers[0].render.mock.calls[0][0].annotations).toEqual(safe);
  });
  it("未映射页面仍展示原件但 onReady 不伪造来源", async () => {
    await render({ page: { ...h.source, mapped: false, runs: [] } });
    expect(props.onReady).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 3, points: [] }));
    expect(host.querySelector("canvas")?.width).toBe(600);
  });
  it("文本层与索引不一致会明确报错，不发布错误映射", async () => {
    await render({ page: { ...h.source, items: [{ ...h.source.items[0], str: "错误版本" }] } });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("不一致");
    expect(props.onReady).not.toHaveBeenCalled(); expect(console.error).toHaveBeenCalled();
  });
  it("高DPI大页受画布像素预算约束而CSS保持原比例", async () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(4);
    h.viewport.width = 4000; h.viewport.height = 6000; await render();
    const canvas = host.querySelector("canvas")!;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(8_000_000);
    expect(canvas.style.width).toBe("4000px"); expect(canvas.style.height).toBe("6000px");
    expect(h.page.render.mock.calls[0]).toBeDefined();
  });
  it("小页DPI最高2倍", async () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(4); await render();
    expect(host.querySelector("canvas")?.width).toBe(1200);
    expect(h.page.render).toHaveBeenCalledWith(expect.objectContaining({ transform: [2, 0, 0, 2, 0, 0] }));
  });
});

describe("PdfPage 生命周期和迟到异步", () => {
  it("卸载取消渲染/文本任务、释放页面并清空所有图层", async () => {
    await render(); const canvas = host.querySelector("canvas")!, text = host.querySelector(".textLayer")!, notes = host.querySelector(".annotationLayer")!;
    await unmount(); expect(h.canvasTask.cancel).toHaveBeenCalledOnce(); expect(h.textLayers[0].cancel).toHaveBeenCalledOnce();
    expect(h.page.cleanup).toHaveBeenCalledOnce(); expect(props.onRemove).toHaveBeenCalledWith(3);
    expect([canvas.width, canvas.height]).toEqual([0, 0]); expect(text.childNodes).toHaveLength(0); expect(notes.childNodes).toHaveLength(0);
  });
  it("getPage 迟到会清理页面且不创建图层", async () => {
    const gate = deferred<typeof h.page>(); h.documentProxy.getPage.mockReturnValue(gate.promise);
    await render(); await unmount(); await act(async () => gate.resolve(h.page));
    expect(h.page.cleanup).toHaveBeenCalledOnce(); expect(h.page.render).not.toHaveBeenCalled(); expect(props.onReady).not.toHaveBeenCalled();
  });
  it("getTextContent 迟到不得触碰已卸载文本DOM", async () => {
    const gate = deferred<Awaited<ReturnType<typeof h.page.getTextContent>>>(); h.page.getTextContent.mockReturnValue(gate.promise);
    await render(); const text = host.querySelector(".textLayer")!; await unmount();
    await act(async () => gate.resolve({ items: [{ str: "第一段正文😀" }], styles: {} }));
    expect(h.textLayers).toHaveLength(0); expect(text.childNodes).toHaveLength(0); expect(props.onReady).not.toHaveBeenCalled();
  });
  it("Canvas未完成不能发布文字映射，卸载后完成也不发布", async () => {
    const gate = deferred<void>(); h.canvasTask.promise = gate.promise; await render();
    expect(props.onReady).not.toHaveBeenCalled(); await unmount(); await act(async () => gate.resolve());
    expect(props.onReady).not.toHaveBeenCalled(); expect(h.annotationLayers).toHaveLength(0);
  });
  it("TextLayer未完成不能发布映射，卸载后完成不创建批注", async () => {
    const gate = deferred<void>(); h.textGate.mockReturnValue(gate.promise); await render();
    expect(props.onReady).not.toHaveBeenCalled(); await unmount(); await act(async () => gate.resolve());
    expect(props.onReady).not.toHaveBeenCalled(); expect(h.annotationLayers).toHaveLength(0);
  });
  it("getAnnotations 迟到不会装配卸载批注DOM", async () => {
    const gate = deferred<unknown[]>(); h.page.getAnnotations.mockReturnValue(gate.promise); await render(); await unmount();
    await act(async () => gate.resolve([{ annotationType: 2 }])); expect(h.annotationLayers).toHaveLength(0);
  });
  it("已启动AnnotationLayer异步完成不能重新写入卸载的展示DOM", async () => {
    const gate = deferred<void>(); h.annotationGate.mockReturnValue(gate.promise); await render();
    const notes = host.querySelector(".annotationLayer")!; expect(h.annotationLayers).toHaveLength(1);
    await unmount(); await act(async () => gate.resolve()); expect(notes.childNodes).toHaveLength(0);
  });
  it("缩放时旧AnnotationLayer迟到不能污染新一轮展示DOM", async () => {
    const gate = deferred<void>(); h.annotationGate.mockReturnValueOnce(gate.promise); await render();
    await render({ scale: 1.5 }); const notes = host.querySelector(".annotationLayer")!;
    expect(notes.childNodes).toHaveLength(1); await act(async () => gate.resolve()); expect(notes.childNodes).toHaveLength(1);
  });
  it("缩放旋转取消上一轮并结合PDF固有旋转重建映射", async () => {
    h.page.rotate = 90; await render(); await render({ scale: 1.5, rotation: 270 });
    expect(h.page.getViewport).toHaveBeenLastCalledWith({ scale: 1.5, rotation: 0 });
    expect(h.canvasTask.cancel).toHaveBeenCalledTimes(1); expect(h.textLayers[0].cancel).toHaveBeenCalledOnce();
    expect(h.page.cleanup).toHaveBeenCalledTimes(1); expect(props.onRemove).toHaveBeenCalledWith(3);
    expect(props.onReady).toHaveBeenCalledTimes(2); expect(host.querySelectorAll(".textLayer span")).toHaveLength(1);
  });
  it("回调变更不重建页面，未完成任务使用当前回调", async () => {
    const gate = deferred<void>(); h.canvasTask.promise = gate.promise; const original = props.onReady;
    await render(); const current = vi.fn<(page: PdfDomPage) => void>(); await render({ onReady: current });
    await act(async () => gate.resolve()); expect(original).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledOnce();
    expect(h.documentProxy.getPage).toHaveBeenCalledOnce();
  });
  it("正常失败展示可理解错误并记录，卸载后取消异常不制造错误UI", async () => {
    h.page.getTextContent.mockRejectedValue(new Error("受控文字读取失败")); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("受控文字读取失败");
    expect(console.error).toHaveBeenCalledWith("PDF页面渲染失败", expect.any(Error)); expect(props.onReady).not.toHaveBeenCalled();
  });
});


describe("PdfPage 异步图层发布与空文本项回归", () => {
  it("staging发布复制几何样式和旋转属性，保留安全链接本身", async () => {
    await render(); const displayed = host.querySelector<HTMLElement>(".annotationLayer")!;
    expect(displayed.style.width).toBe("600px"); expect(displayed.dataset.mainRotation).toBe("90");
    expect(displayed.querySelector("a")?.textContent).toBe("受控批注"); expect(h.annotationLayers[0].options.div.isConnected).toBe(false);
  });
  it("PDF.js未挂载的空str项不阻断其它真实文本映射", async () => {
    h.page.getTextContent.mockResolvedValue({ items: [{ str: "" }, { str: "第一段正文😀" }], styles: {} });
    const page = { ...h.source, items: [{ ...h.source.items[0], str: "" }, h.source.items[0]], runs: h.source.runs.map(run => ({ ...run, itemIndex: 1 })) };
    await render({ page }); expect(h.textLayers[0].textDivs[0].isConnected).toBe(false);
    expect(props.onReady).toHaveBeenCalledOnce(); expect(vi.mocked(props.onReady).mock.calls[0][0].points).toHaveLength(7);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("非空str脱离TextLayer仍严格拒绝，不能借空项规则放宽归属", async () => {
    h.detachedText.add(0); await render();
    const calls = vi.mocked(props.onReady).mock.calls; expect(calls.flatMap(([page]) => page.points)).toHaveLength(0);
  });
  it("旧批注任务迟到失败不能给新缩放页面显示错误", async () => {
    const gate = deferred<void>(); h.annotationGate.mockReturnValueOnce(gate.promise); await render(); await render({ scale: 1.5 });
    await act(async () => gate.reject(new Error("旧任务失败")));
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(console.error).not.toHaveBeenCalled();
    expect(host.querySelector(".annotationLayer")?.textContent).toBe("受控批注");
  });
  it("卸载后任务取消拒绝不回调、不产生误报", async () => {
    const gate = deferred<void>(); h.canvasTask.promise = gate.promise; await render(); await unmount();
    await act(async () => gate.reject(new Error("RenderingCancelledException")));
    expect(props.onReady).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
  });
  it("替换原件时旧getPage迟到清理但不为新版发布映射", async () => {
    const old = h, gate = deferred<typeof old.page>(); old.documentProxy.getPage.mockReturnValue(gate.promise); await render();
    h = harness(); await render({ document: h.documentProxy as unknown as PDFDocumentProxy, runtime: h.runtime, page: h.source });
    expect(props.onReady).toHaveBeenCalledOnce(); await act(async () => gate.resolve(old.page));
    expect(old.page.cleanup).toHaveBeenCalledOnce(); expect(old.page.render).not.toHaveBeenCalled(); expect(props.onReady).toHaveBeenCalledOnce();
  });
});

describe("PdfPage getTextContent等待期间Canvas拒绝", () => {
  async function observeUnhandled(run: () => Promise<void>) {
    const nodeRejected = vi.fn(), browserRejected = vi.fn();
    process.on("unhandledRejection", nodeRejected); window.addEventListener("unhandledrejection", browserRejected);
    try { await run(); await new Promise<void>(resolve => setTimeout(resolve, 0)); expect(nodeRejected).not.toHaveBeenCalled(); expect(browserRejected).not.toHaveBeenCalled(); }
    finally { process.off("unhandledRejection", nodeRejected); window.removeEventListener("unhandledrejection", browserRejected); }
  }
  it("getTextContent尚未完成就卸载取消Canvas，无未处理拒绝或迟到写DOM", async () => {
    const content = deferred<Awaited<ReturnType<typeof h.page.getTextContent>>>(), canvas = deferred<void>();
    h.page.getTextContent.mockReturnValue(content.promise); h.canvasTask.promise = canvas.promise;
    h.canvasTask.cancel.mockImplementation(() => canvas.reject(Object.assign(new Error("page cancelled"), { name: "RenderingCancelledException" })));
    await observeUnhandled(async () => {
      await render(); expect(h.page.getTextContent).toHaveBeenCalledOnce(); expect(h.textLayers).toHaveLength(0);
      const text = host.querySelector(".textLayer")!; await unmount();
      // WHY：跨一个事件循环观察未处理拒绝，不能先resolve文本让旧实现赶在观测前挂上Promise.all。
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await act(async () => content.resolve({ items: [{ str: "第一段正文😀" }], styles: {} }));
      expect(text.childNodes).toHaveLength(0); expect(props.onReady).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
    });
  });
  it("文字等待期间缩放取消旧Canvas，新页完成而旧拒绝不成为unhandled", async () => {
    const content = deferred<Awaited<ReturnType<typeof h.page.getTextContent>>>(), canvas = deferred<void>();
    const oldTask = { promise: canvas.promise, cancel: vi.fn(() => canvas.reject(Object.assign(new Error("zoom cancel"), { name: "RenderingCancelledException" }))) };
    h.page.render.mockReturnValueOnce(oldTask); h.page.getTextContent.mockReturnValueOnce(content.promise);
    await observeUnhandled(async () => {
      await render(); await render({ scale: 1.5 }); expect(oldTask.cancel).toHaveBeenCalledOnce(); expect(props.onReady).toHaveBeenCalledOnce();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await act(async () => content.resolve({ items: [{ str: "第一段正文😀" }], styles: {} }));
      expect(props.onReady).toHaveBeenCalledOnce(); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(console.error).not.toHaveBeenCalled();
    });
  });
  it("Canvas真实错误即使早于文字完成也被收接，随后明确展示而非吞掉", async () => {
    const content = deferred<Awaited<ReturnType<typeof h.page.getTextContent>>>(), canvas = deferred<void>(), failure = new Error("真实Canvas渲染失败");
    h.page.getTextContent.mockReturnValue(content.promise); h.canvasTask.promise = canvas.promise;
    await observeUnhandled(async () => {
      await render(); await act(async () => canvas.reject(failure)); await new Promise<void>(resolve => setTimeout(resolve, 0));
      await act(async () => content.resolve({ items: [{ str: "第一段正文😀" }], styles: {} }));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(failure.message);
      expect(console.error).toHaveBeenCalledWith("PDF页面渲染失败", failure); expect(props.onReady).not.toHaveBeenCalled();
    });
  });
});


describe("PdfPage直装PDF.js图层的CSS变量契约", () => {
  // WHY：这里只验页面输出的CSS变量与userUnit传播；jsdom不提供真实排版，链接实际宽高由浏览器验收。
  it("页面等待加载时就提供round所需1px变量，不依赖.pdfViewer祖先", async () => {
    const gate = deferred<typeof h.page>(); h.documentProxy.getPage.mockReturnValue(gate.promise); await render({ scale: 1.25 });
    const surface = host.querySelector<HTMLElement>(".pdf-page-layers")!;
    expect(surface.closest(".pdfViewer")).toBeNull(); expect(surface.style.getPropertyValue("--scale-round-x")).toBe("1px");
    expect(surface.style.getPropertyValue("--scale-round-y")).toBe("1px"); expect(surface.style.getPropertyValue("--scale-factor")).toBe("1.25");
    await act(async () => gate.resolve(h.page)); expect(surface.style.getPropertyValue("--total-scale-factor")).toBe("1.25");
  });
  it("非1userUnit参与总缩放，文字与批注都位于变量继承的页面内", async () => {
    h.page.userUnit = 2; await render({ scale: 1.5 }); const surface = host.querySelector<HTMLElement>(".pdf-page-layers")!;
    expect(surface.style.getPropertyValue("--user-unit")).toBe("2"); expect(surface.style.getPropertyValue("--total-scale-factor")).toBe("3");
    expect(h.page.getViewport).toHaveBeenCalledWith({ scale: 1.5, rotation: 0 });
    expect(surface.contains(host.querySelector(".textLayer"))).toBe(true); expect(surface.contains(host.querySelector(".annotationLayer"))).toBe(true);
    expect(host.querySelector(".annotationLayer a")?.textContent).toBe("受控批注");
  });
  it("缩放旋转重渲染保留userUnit并更新总缩放，不恢复默认1", async () => {
    h.page.userUnit = 2; await render(); await render({ scale: 0.75, rotation: 90 }); const surface = host.querySelector<HTMLElement>(".pdf-page-layers")!;
    expect(surface.style.getPropertyValue("--scale-factor")).toBe("0.75"); expect(surface.style.getPropertyValue("--user-unit")).toBe("2");
    expect(surface.style.getPropertyValue("--total-scale-factor")).toBe("1.5"); expect(surface.style.getPropertyValue("--scale-round-x")).toBe("1px");
    expect(surface.style.getPropertyValue("--scale-round-y")).toBe("1px"); expect(h.page.getViewport).toHaveBeenLastCalledWith({ scale: 0.75, rotation: 90 });
  });
});
