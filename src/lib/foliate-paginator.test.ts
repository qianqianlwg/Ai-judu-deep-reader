// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Layout = { width: number; height: number; gap: number; columnWidth: number; margin: number };
type FrameView = {
  element: HTMLElement;
  load(src: string, afterLoad?: (doc: Document) => void, beforeRender?: () => Layout): Promise<void>;
  render(layout: Layout): void;
  expand(): void;
  destroy(): void;
};
const url = "blob:http://localhost/chapter-one";
const layout: Layout = { width: 800, height: 600, gap: 20, columnWidth: 760, margin: 20 };
let view: FrameView, iframe: HTMLIFrameElement, sourceFrame: HTMLIFrameElement, doc: Document;
let current: Document | null, resize: () => void;
const onExpand = vi.fn(), observe = vi.fn(), disconnect = vi.fn();

beforeEach(async () => {
  const source = await readFile("public/vendor/foliate/paginator.js", "utf8");
  // WHY：仅在单测VM暴露内部View，执行实际分发代码；不改产品shadow、sandbox或文档运输。
  const View = runInNewContext(source.slice(0, source.indexOf("export class Paginator")) + "\nView", {
    document, NodeFilter, DOMRect, DOMException, console,
    ResizeObserver: class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe; disconnect = disconnect;
    },
  }) as new (options: { container: HTMLElement; onExpand: () => void }) => FrameView;
  view = new View({ container: document.body, onExpand });
  iframe = view.element.querySelector("iframe")!;
  sourceFrame = document.createElement("iframe"); document.body.append(sourceFrame);
  doc = sourceFrame.contentDocument!; doc.body.innerHTML = "<p>真实章节回调测试</p>";
  Object.defineProperty(doc, "URL", { configurable: true, value: url });
  Object.defineProperty(doc, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 600, 400) });
  current = document.implementation.createHTMLDocument();
  Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => current });
});
afterEach(() => { view?.destroy(); sourceFrame?.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function loaded(target: Document | null = doc) { current = target; iframe.dispatchEvent(new Event("load")); }

it("空白/迟到其他章节load不能提前完成，目标章节才正常排版", async () => {
  const after = vi.fn(), complete = vi.fn();
  const task = view.load(url, after, () => layout).then(complete);
  loaded(current); await Promise.resolve(); expect(after).not.toHaveBeenCalled();
  Object.defineProperty(doc, "URL", { configurable: true, value: "blob:http://localhost/old" });
  loaded(); await Promise.resolve(); expect(complete).not.toHaveBeenCalled();
  Object.defineProperty(doc, "URL", { configurable: true, value: url });
  loaded(); await task;
  expect(after).toHaveBeenCalledExactlyOnceWith(doc); expect(observe).toHaveBeenCalledWith(doc.body);
  expect(onExpand).toHaveBeenCalled(); expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
  expect(iframe.src).toBe(url);
});
it.each(["afterLoad", "layout", "render"])("%s抛异常立即reject，不能退化成20秒超时", async (stage) => {
  const failure = new Error(`章节${stage}失败`), fail = () => { throw failure; };
  if (stage === "render") vi.spyOn(view, "render").mockImplementation(fail);
  const task = view.load(url, stage === "afterLoad" ? fail : undefined, stage === "layout" ? fail : () => layout);
  const assertion = expect(task).rejects.toBe(failure); loaded(); await assertion;
  onExpand.mockClear(); resize(); expect(onExpand).not.toHaveBeenCalled();
});
it("iframe error立即reject，后续load不再触发业务回调", async () => {
  const after = vi.fn(), task = view.load(url, after, () => layout);
  const assertion = expect(task).rejects.toThrow("原版章节文档加载失败");
  iframe.dispatchEvent(new Event("error")); await assertion; loaded(); expect(after).not.toHaveBeenCalled();
});
it("关闭终结pending加载且清理监听，迟到load和ResizeObserver不能回写", async () => {
  const after = vi.fn(), task = view.load(url, after, () => layout);
  const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
  view.destroy(); await assertion; loaded(); resize();
  expect(after).not.toHaveBeenCalled(); expect(onExpand).not.toHaveBeenCalled(); expect(disconnect).toHaveBeenCalled();
  await expect(view.load(url)).rejects.toMatchObject({ name: "AbortError" });
});
it("未就绪时ResizeObserver不得对about:blank产生假进度", () => {
  resize(); view.render(layout); expect(onExpand).not.toHaveBeenCalled();
});
it("同一View重载取消旧等待，只有新章节能完成", async () => {
  const oldAfter = vi.fn(), first = view.load("blob:http://localhost/old", oldAfter, () => layout);
  const assertion = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const after = vi.fn(), next = view.load(url, after, () => layout); await assertion;
  loaded(); await next; expect(oldAfter).not.toHaveBeenCalled(); expect(after).toHaveBeenCalledOnce();
});
it("src赋值异常必须清理监听，不能在后续load重新执行回调", async () => {
  const after = vi.fn(); Object.defineProperty(iframe, "src", { set: () => { throw new Error("导航已拒绝"); } });
  await expect(view.load(url, after, () => layout)).rejects.toThrow("导航已拒绝");
  loaded(); expect(after).not.toHaveBeenCalled();
});

it("load业务回调同步关闭View时，不能复活布局或重新订阅observer", async () => {
  const task = view.load(url, () => view.destroy(), () => layout);
  const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" }); loaded(); await assertion;
  expect(observe).not.toHaveBeenCalled(); expect(onExpand).not.toHaveBeenCalled();
});
