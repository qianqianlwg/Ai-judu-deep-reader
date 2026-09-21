// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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


type Navigation = { index: number; anchor?: number };
type TestSection = { load(): Promise<string>; unload(): void };
type TestPaginator = HTMLElement & {
  open(book: { sections: TestSection[] }): void;
  goTo(target: Navigation | Promise<Navigation>): Promise<void>;
  next(): Promise<void>;
  getContents(): { index: number; doc: Document | null }[];
  scrollToAnchor(anchor: number): Promise<void>;
  destroy(): void;
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flushNavigation() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

describe("实际分发Paginator的外层销毁边界", () => {
  const paginators: TestPaginator[] = [];
  async function makePaginator(section: TestSection) {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
    // WHY：直接导入完整分发模块，只桩浏览器平台API；不打开shadow，也不改写iframe运输。
    const path = "../../public/vendor/foliate/paginator.js";
    const { Paginator } = await import(path) as { Paginator: new () => TestPaginator };
    const paginator = new Paginator(); paginator.open({ sections: [section] });
    paginators.push(paginator);
    return paginator;
  }
  afterEach(() => { for (const paginator of paginators.splice(0)) paginator.destroy(); vi.unstubAllGlobals(); });

  it.each(["resolve", "reject"])("等待section.load时销毁立即拒绝导航，迟到%s不能复活iframe/contents", async outcome => {
    const work = deferred<string>(), section = { load: vi.fn(() => work.promise), unload: vi.fn() };
    const paginator = await makePaginator(section), create = vi.spyOn(document, "createElement");
    const rejected = vi.fn(), navigation = paginator.goTo({ index: 0 });
    void navigation.catch(rejected);
    await flushNavigation(); expect(section.load).toHaveBeenCalledOnce();
    paginator.destroy(); await flushNavigation();
    const failureBeforeLateResult: unknown = rejected.mock.calls[0]?.[0];
    if (outcome === "resolve") work.resolve(url); else work.reject(new Error("迟到章节失败"));
    await flushNavigation();
    expect(failureBeforeLateResult).toMatchObject({ name: "AbortError" });
    expect(rejected).toHaveBeenCalledOnce();
    expect(create.mock.calls.filter(([tag]) => tag === "iframe")).toHaveLength(0);
    expect(paginator.getContents()).toEqual([]); expect(paginator.shadowRoot).toBeNull();
    paginator.destroy(); expect(paginator.getContents()).toEqual([]);
  });

  it("section.load的原始拒绝直接传播，不能吞错后display空对象", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("章节资源读取失败");
    const paginator = await makePaginator({ load: async () => { throw failure; }, unload() {} });
    const scroll = vi.spyOn(paginator, "scrollToAnchor"), create = vi.spyOn(document, "createElement");
    await expect(paginator.goTo({ index: 0 })).rejects.toBe(failure);
    expect(scroll).not.toHaveBeenCalled(); expect(paginator.getContents()).toEqual([]);
    expect(create.mock.calls.filter(([tag]) => tag === "iframe")).toHaveLength(0);
  });

  it("资源已resolve但display尚未续行时销毁，不创建iframe", async () => {
    const work = deferred<string>(), section = { load: vi.fn(() => work.promise), unload: vi.fn() };
    const paginator = await makePaginator(section), create = vi.spyOn(document, "createElement");
    const navigation = paginator.goTo({ index: 0 });
    const assertion = expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    await flushNavigation(); work.resolve(url); paginator.destroy(); await assertion; await flushNavigation();
    expect(create.mock.calls.filter(([tag]) => tag === "iframe")).toHaveLength(0);
    expect(paginator.getContents()).toEqual([]);
  });

  it("等待导航目标期间销毁也立即结束等待，迟到拒绝被消费", async () => {
    const target = deferred<Navigation>(), section = { load: vi.fn(async () => url), unload: vi.fn() };
    const paginator = await makePaginator(section), rejected = vi.fn();
    void paginator.goTo(target.promise).catch(rejected);
    paginator.destroy(); await flushNavigation();
    const failureBeforeLateResult: unknown = rejected.mock.calls[0]?.[0];
    target.reject(new Error("迟到导航目标失败")); await flushNavigation();
    expect(failureBeforeLateResult).toMatchObject({ name: "AbortError" });
    expect(rejected).toHaveBeenCalledOnce(); expect(section.load).not.toHaveBeenCalled();
  });

  it("销毁后的新导航拒绝且不启动section.load", async () => {
    const section = { load: vi.fn(async () => url), unload: vi.fn() }, paginator = await makePaginator(section);
    paginator.destroy();
    await expect(paginator.goTo({ index: 0 })).rejects.toMatchObject({ name: "AbortError" });
    await expect(paginator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(section.load).not.toHaveBeenCalled(); expect(paginator.getContents()).toEqual([]);
  });

  it("翻页等待资源时销毁立即结束等待，迟到成功不能建iframe", async () => {
    const work = deferred<string>(), section = { load: vi.fn(() => work.promise), unload: vi.fn() };
    const paginator = await makePaginator(section), create = vi.spyOn(document, "createElement");
    const navigation = paginator.next(), assertion = expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    await flushNavigation(); expect(section.load).toHaveBeenCalledOnce();
    paginator.destroy(); await assertion;
    work.resolve(url); await flushNavigation();
    expect(create.mock.calls.filter(([tag]) => tag === "iframe")).toHaveLength(0);
    expect(paginator.getContents()).toEqual([]);
  });

  it("翻页资源失败保留原始错误并释放锁，不能把下一次导航伪装成成功", async () => {
    const failure = new Error("翻页资源失败"), section = { load: vi.fn(async () => { throw failure; }), unload: vi.fn() };
    const paginator = await makePaginator(section);
    await expect(paginator.next()).rejects.toBe(failure);
    await expect(paginator.next()).rejects.toBe(failure);
    expect(section.load).toHaveBeenCalledTimes(2); expect(paginator.getContents()).toEqual([]);
  });

  it("存活会话仍保留翻页中忽略goTo的原有互斥语义", async () => {
    const work = deferred<string>(), target = deferred<Navigation>();
    const section = { load: vi.fn(() => work.promise), unload: vi.fn() }, paginator = await makePaginator(section);
    const navigation = paginator.next(), assertion = expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    await flushNavigation();
    await paginator.goTo(target.promise); expect(section.load).toHaveBeenCalledOnce();
    target.resolve({ index: 0 }); paginator.destroy(); await assertion;
    work.resolve(url); await flushNavigation(); expect(paginator.getContents()).toEqual([]);
  });

  it("未销毁时正常创建原生iframe，销毁终止其load等待", async () => {
    const work = deferred<string>(), paginator = await makePaginator({ load: () => work.promise, unload() {} });
    const create = vi.spyOn(document, "createElement"), navigation = paginator.goTo({ index: 0 });
    const assertion = expect(navigation).rejects.toMatchObject({ name: "AbortError" });
    await flushNavigation(); work.resolve(url); await flushNavigation();
    const frameCall = create.mock.calls.findIndex(([tag]) => tag === "iframe");
    const frame: unknown = create.mock.results[frameCall]?.value;
    expect(frame).toBeInstanceOf(HTMLIFrameElement);
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("没有创建iframe");
    expect(frame.src).toBe(url); expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(paginator.shadowRoot).toBeNull(); expect(paginator.getContents()).toHaveLength(1);
    paginator.destroy(); await assertion; expect(paginator.getContents()).toEqual([]);
  });
});
