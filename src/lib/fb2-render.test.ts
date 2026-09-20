// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFb2Book, type Fb2Book } from "./fb2-book";
import { createFb2FoliateBook } from "./fb2-render";
import { mapEpubDocument, readLimitedEpubSelection, selectionFromEpubRange, sameEpubResource } from "./epub-source-map";
import { previewEpubLink } from "./epub-link-preview";
import type { LibraryChapter } from "./library";
import type { FoliateBook, FoliateBridge } from "./foliate-types";

let fixture: string, bridge: FoliateBridge, model: Fb2Book;
let allocated: Map<string, Blob>, revoked: Set<string>, books: FoliateBook[], counter: number;
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
function create(value = model) { const book = createFb2FoliateBook(value); books.push(book); return book; }
function chapter(index: number, value = model): LibraryChapter { const source = value.sections[index]; return { id: `c${index}`, title: source.title, sourceHref: source.href, paragraphs: source.paragraphs.map((text, n) => ({ id: `p${index}-${n}`, text })) }; }
beforeAll(async () => {
  fixture = await readFile("src/lib/fixtures/reader.fb2", "utf8");
  const path = "../../public/vendor/foliate/bridge.js"; bridge = await import(path) as FoliateBridge;
});
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("CSS", { escape: (value: string) => value });
  allocated = new Map(); revoked = new Set(); books = []; counter = 0; model = parseFb2Book(bytes(fixture));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { const url = `blob:fb2-${++counter}`; allocated.set(url, blob); return url; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((url: string) => { revoked.add(url); }) });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("验收禁止网络和真实AI"); })); vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => { for (const book of books) book.destroy?.(); document.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FB2安全编译后的Foliate原书装配", () => {
  it("章节、目录、元数据和非线性脚注保持模型一致", async () => {
    const book = create(); expect(book.sections).toHaveLength(3);
    expect(book.metadata).toEqual({ title: model.title, author: model.author, language: "zh" }); expect(book.rendition?.layout).toBe("reflowable");
    expect(book.sections.map(section => section.id)).toEqual(model.sections.map(section => section.href));
    expect(book.toc).toEqual([
      { label: "第一章：图文与脚注", href: "fb2-v1/section-0.xhtml", subitems: [{ label: "嵌套小节", href: "fb2-v1/section-0.xhtml#nested" }] },
      { label: "第二章", href: "fb2-v1/section-1.xhtml" },
      { label: "注释", href: "fb2-v1/section-2.xhtml", subitems: [{ label: "注释一", href: "fb2-v1/section-2.xhtml#note-one" }] },
    ]);
    expect(book.sections[2].linear).toBe("no"); expect(book.sections[0].linear).toBeUndefined();
    for (const [index, section] of book.sections.entries()) {
      const doc = await section.createDocument(); expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.documentElement.namespaceURI).toBe("http://www.w3.org/1999/xhtml"); expect(doc.documentElement.lang).toBe("zh");
      expect(doc.title).toBe(model.sections[index].title); expect(doc.querySelector("h1")).not.toBeNull();
    }
  });
  it("每个章节均有禁止脚本/网络/对象/表单的CSP，仅允许owned blob图片和内联静态样式", async () => {
    const book = create();
    for (const section of book.sections) {
      const doc = await section.createDocument(), csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!;
      for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "img-src blob:", "style-src 'unsafe-inline'"]) expect(csp).toContain(directive);
      expect(doc.querySelector("script,iframe,object,embed,form,base,link[rel='stylesheet']")).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("正文含实体、emoji、strong、诗歌和表格，不损坏文本或样式结构", async () => {
    const doc = await create().sections[0].createDocument();
    expect(doc.body.textContent).toContain("字符保真：<公式> x & y，😀增补字符。"); expect(doc.querySelector("strong")?.textContent).toBe("重要概念");
    expect([...doc.querySelectorAll(".fb2-v")].map(node => node.textContent)).toEqual(["第一行诗。", "第二行诗。"]);
    expect([...doc.querySelectorAll("th,td")].map(node => node.textContent)).toEqual(["名称", "说明", "文本", "表格保留"]);
    expect(doc.querySelector("style")?.textContent).toContain("img{max-width:100%;height:auto}"); expect(doc.querySelector("style")?.textContent).toContain(".fb2-poem");
    expect(doc.querySelector("style")?.textContent).not.toMatch(/url\(|@import/u);
  });
  it("binary图片只分配本地blob，内容/MIME/alt准确且多个文档共享owned资源", async () => {
    const book = create(), first = await book.sections[0].createDocument(), second = await book.sections[0].createDocument();
    const image = first.querySelector("img")!, url = image.getAttribute("src")!;
    expect(url).toMatch(/^blob:fb2-/u); expect(allocated.get(url)?.type).toBe("image/png");
    expect(new Uint8Array(await allocated.get(url)!.arrayBuffer())).toEqual(model.images[0].bytes);
    expect(image.getAttribute("alt")).toBe("本地嵌入像素"); expect(image.hasAttribute("data-fb2-image")).toBe(false);
    expect(second.querySelector("img")?.getAttribute("src")).toBe(url); expect(allocated.size).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it("编码成文本的HTML/事件属性不能逃逸成节点或可执行属性", async () => {
    const source = fixture.replace("字符保真：", '&lt;script&gt;window.evil()&lt;/script&gt; &lt;img src="https://invalid.example/x" onerror="evil()"/&gt; 字符保真：')
      .replace('alt="本地嵌入像素"', 'alt="&quot; onerror=&quot;evil()&quot; &lt;svg&gt;"');
    const doc = await create(parseFb2Book(bytes(source))).sections[0].createDocument();
    expect(doc.body.textContent).toContain('<script>window.evil()</script>'); expect(doc.body.textContent).toContain('<img src="https://invalid.example/x"');
    expect(doc.querySelector("script,svg,[onerror],[onclick]")).toBeNull(); expect(doc.querySelectorAll("img")).toHaveLength(1);
    expect(doc.querySelector("img")?.getAttribute("alt")).toBe('" onerror="evil()" <svg>'); expect(fetch).not.toHaveBeenCalled();
  });
  it("章标题和language序列化均转义，不允许形成额外head节点", async () => {
    const changed = { ...model, language: 'zh" onload="bad', sections: model.sections.map((section, i) => i ? section : { ...section, title: '</title><script>evil()</script>' }) };
    const doc = await create(changed).sections[0].createDocument(); expect(doc.title).toBe(changed.sections[0].title);
    expect(doc.documentElement.lang).toBe(changed.language); expect(doc.querySelector("script,[onload]")).toBeNull();
  });
  it("真实原始script/foreign HTML元素在编译前拒绝，不提供raw HTML fallback", () => {
    const source = fixture.replace('<p id="source-one">', '<script>evil()</script><p id="source-one">');
    expect(() => create(parseFb2Book(bytes(source)))).toThrow(); expect(allocated.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("load返回原生XHTML blob而非srcdoc/API替代运输，createDocument与blob文字一致", async () => {
    const book = create(), url = await book.sections[0].load(), blob = allocated.get(url!)!;
    expect(blob.type).toBe("application/xhtml+xml"); const source = await blob.text(), parsed = new DOMParser().parseFromString(source, "application/xhtml+xml");
    expect(source).toContain("Content-Security-Policy"); expect(source).not.toMatch(/srcdoc=|\/api\/|shadowrootmode/u);
    expect(parsed.body.textContent).toBe((await book.sections[0].createDocument()).body.textContent);
  });
});

describe("FB2双向链接与精确正文来源", () => {
  it("正文到脚注与脚注返回均由resolveHref和previewEpubLink定位", async () => {
    const book = create(), sourceDoc = await book.sections[0].createDocument();
    const noteHref = sourceDoc.querySelector('a[epub\\:type="noteref"]')!.getAttribute("href")!;
    const preview = await previewEpubLink(noteHref, book.sections, 0, sourceDoc); expect(preview.index).toBe(2); expect(preview.fragment).toBe("note-one");
    expect(preview.text).toContain("这是本地脚注内容"); const target = book.resolveHref!(noteHref)!; expect(target.index).toBe(2);
    const notesDoc = await book.sections[2].createDocument(); expect((target.anchor(notesDoc) as Element).id).toBe("note-one");
    const backHref = notesDoc.querySelector("a")!.getAttribute("href")!, back = await previewEpubLink(backHref, book.sections, 2, notesDoc);
    expect(back.index).toBe(0); expect(back.text).toBe("重复正文用于验证版本定位。"); expect((book.resolveHref!(backHref)!.anchor(sourceDoc) as Element).id).toBe("source-one");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("TOC和嵌套小节有稳定相对sourceHref及可用anchor", async () => {
    const book = create(), doc = await book.sections[0].createDocument();
    expect(book.splitTOCHref!("/fb2-v1/section-0.xhtml#nested")).toEqual(["fb2-v1/section-0.xhtml", "nested"]);
    expect(book.getTOCFragment!(doc, "nested")?.tagName.toLowerCase()).toBe("section");
    for (const [i, item] of book.toc!.entries()) expect(book.resolveHref!(item.href)?.index).toBe(i);
    expect(sameEpubResource("/fb2-v1/section-0.xhtml#nested", chapter(0).sourceHref)).toBe(true);
  });
  it("外部链接只显示地址，不能解析为包内跳转或触发网络", async () => {
    const value = parseFb2Book(bytes(fixture.replace('字符保真：', '<a l:href="https://invalid.example/book">外部资料</a>字符保真：'))), book = create(value), doc = await book.sections[0].createDocument();
    const external = doc.querySelector('a[href^="https:"]')!.getAttribute("href")!;
    expect(book.isExternal!(external)).toBe(true); expect(book.resolveHref!(external)).toBeNull();
    expect(await previewEpubLink(external, book.sections, 0, doc)).toEqual({ title: "外部链接", text: "外部链接不自动访问。", address: external }); expect(fetch).not.toHaveBeenCalled();
  });
  it("三个章节逐个data-fb2-paragraph映射完整，诗行/表头/单元格都可定位", async () => {
    const book = create();
    for (const [index, section] of book.sections.entries()) {
      const doc = await section.createDocument(), expected = chapter(index), maps = mapEpubDocument(doc, expected, "[data-fb2-paragraph]");
      expect(maps).toHaveLength(expected.paragraphs.length); expect(maps.map(map => map.paragraph)).toEqual(expected.paragraphs);
      expect(maps.every(map => map.element.hasAttribute("data-fb2-paragraph"))).toBe(true);
      for (const map of maps) { const range = doc.createRange(); range.selectNodeContents(map.element); expect(selectionFromEpubRange(range, maps)?.text).toBe(map.paragraph.text); }
    }
  });
  it("重复文字在不同章节保留各自ID，不用首次同文跨章猜映射", async () => {
    const book = create(); const results = await Promise.all([0, 1].map(async index => { const doc = await book.sections[index].createDocument(), maps = mapEpubDocument(doc, chapter(index), "[data-fb2-paragraph]"); const map = maps.find(item => item.paragraph.text === "重复正文用于验证版本定位。")!; const range = doc.createRange(); range.selectNodeContents(map.element); return selectionFromEpubRange(range, maps)!; }));
    expect(results[0].text).toBe(results[1].text); expect(results[0].paragraphId).not.toBe(results[1].paragraphId);
  });
  it("跨段且含strong的Range保留有序片段及UTF16原文", async () => {
    const book = create(), doc = await book.sections[0].createDocument(), maps = mapEpubDocument(doc, chapter(0), "[data-fb2-paragraph]");
    const range = doc.createRange(); range.setStart(maps[1].points[0].node, maps[1].points[0].offset); const last = maps[2].points.at(-1)!; range.setEnd(last.node, last.offset + 1);
    const selected = selectionFromEpubRange(range, maps)!; expect(selected.version).toBe(2); expect(selected.fragments?.map(part => part.paragraphId)).toEqual(["p0-1", "p0-2"]);
    expect(selected.text).toContain("😀增补字符。重要概念");
  });
  it.each([999, 1000, 1001])("FB2选择%d字沿用1000硬上限并限制可见原生Range", async count => {
    const value = parseFb2Book(bytes(fixture.replace("重复正文用于验证版本定位。", "甲".repeat(count))));
    const doc = await create(value).sections[0].createDocument(), frame = document.createElement("iframe"); document.body.append(frame);
    try {
      const activeDoc = frame.contentDocument!; activeDoc.body.innerHTML = doc.body.innerHTML; const maps = mapEpubDocument(activeDoc, chapter(0, value), "[data-fb2-paragraph]");
      const map = maps.find(item => item.paragraph.text === "甲".repeat(count))!, range = activeDoc.createRange(); range.selectNodeContents(map.element);
      const selection = activeDoc.getSelection()!; selection.addRange(range); const limit = vi.fn(); const result = readLimitedEpubSelection(selection, maps, limit)!;
      expect(Array.from(result.text)).toHaveLength(Math.min(count, 1000)); expect(selection.toString()).toBe(result.text);
      expect(limit).toHaveBeenCalledTimes(count > 1000 ? 1 : 0);
    } finally { frame.remove(); }
  });
});

describe("FB2真实固定版View的CFI接口与ownedURLs", () => {
  it("真实固定版View闭合shadowroot，CFI跨重建文档往返到相同原文", async () => {
    expect(bridge.revision).toBe("78914aef4466eb960965702401634c2cb348e9b1"); const book = create(), view = bridge.createView();
    // WHY：真实View的CFI接口不需要layout；只装配book，不调用jsdom不支持的iframe分页渲染，也不打开shadowroot。
    Object.assign(view, { book }); expect(view.tagName).toBe("FOLIATE-VIEW"); expect(view.shadowRoot).toBeNull();
    for (const index of [0, 1, 2]) {
      const doc = await book.sections[index].createDocument(), element = doc.querySelectorAll("[data-fb2-paragraph]")[1], range = doc.createRange(); range.selectNodeContents(element);
      const cfi = view.getCFI(index, range), target = view.resolveCFI(cfi), restored = target.anchor(await book.sections[index].createDocument());
      const textRange = doc.createRange(); textRange.selectNodeContents(element.firstChild!);
      const textCFI = view.getCFI(index, textRange), textRestored = view.resolveCFI(textCFI).anchor(await book.sections[index].createDocument());
      expect((textRestored as Range).toString()).toBe(textRange.toString());
      expect(cfi).toMatch(/^epubcfi\(/u); expect(target.index).toBe(index); expect(restored).toBeInstanceOf(Range); expect((restored as Range).toString()).toBe(range.toString());
    }
    view.close();
  });
  it("相同章节并发load复用blob，unload仅撤销本章且再次load生成新URL", async () => {
    const book = create(), imageURL = (await book.sections[0].createDocument()).querySelector("img")!.getAttribute("src")!;
    const [a, b] = await Promise.all([book.sections[0].load(), book.sections[0].load()]); expect(a).toBe(b);
    book.sections[0].unload(); expect(revoked.has(a!)).toBe(true); expect(revoked.has(imageURL)).toBe(false);
    expect(await book.sections[0].load()).not.toBe(a); expect(allocated.size).toBe(3);
  });
  it("destroy撤销全部图片/章节URL且幂等，之后资源API拒绝", async () => {
    const book = create(); await Promise.all(book.sections.map(section => section.load())); const owned = [...allocated.keys()];
    book.destroy!(); book.destroy!(); book.sections.forEach(section => section.unload()); expect([...revoked].sort()).toEqual(owned.sort());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(owned.length);
    await expect(book.sections[0].load()).rejects.toThrow("已销毁"); await expect(book.sections[0].createDocument()).rejects.toThrow("已销毁"); expect(() => book.resolveHref!(book.sections[0].id)).toThrow("已销毁");
  });
  it("load promise尚未交回调用方就destroy，迟到URL也已撤销且不再分配资源", async () => {
    const book = create(), pending = book.sections[0].load(); book.destroy!(); const url = await pending;
    expect(revoked.has(url!)).toBe(true); expect(revoked.size).toBe(allocated.size); await expect(book.sections[1].load()).rejects.toThrow("已销毁");
  });
  it("图片创建中途异常撤销已经分配的URL", () => {
    const value = { ...model, images: [model.images[0], { ...model.images[0], id: "second" }] };
    vi.mocked(URL.createObjectURL).mockImplementationOnce(blob => { if (!(blob instanceof Blob)) throw new Error("测试只允许Blob资源"); const url = "blob:first"; allocated.set(url, blob); return url; }).mockImplementationOnce(() => { throw new Error("资源创建失败"); });
    expect(() => create(value)).toThrow("资源创建失败"); expect(revoked).toEqual(new Set(["blob:first"]));
  });
  it("章节序列化失败同样销毁先前创建的图片，不留泄漏", () => {
    const value = { ...model, images: [] }; expect(() => create(value)).toThrow("图片资源不可用"); expect(revoked.size).toBe(allocated.size);
  });
});



describe("FB2封面与非线性声明保持源文件语义", () => {
  it("description封面生成可显示的原版图像章但不伪造可句读段落", async () => {
    const value = parseFb2Book(bytes(fixture.replace("<genre>reference</genre>", '<genre>reference</genre><coverpage><image l:href="#pixel"/></coverpage>'))), book = create(value);
    expect(book.sections.length).toBe(model.sections.length + 1); const cover = await book.sections[0].createDocument();
    expect(cover.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/u); expect(cover.querySelector("[data-fb2-paragraph]")).toBeNull();
    expect(mapEpubDocument(cover, chapter(0, value), "[data-fb2-paragraph]")).toEqual([]);
    expect((await book.sections[1].createDocument()).body.textContent).toContain("字符保真：");
  });
  it("后续普通body仍线性阅读，仅显式notes非线性", async () => {
    const source = fixture.replace('<body name="notes">', '<body name="continuation"><section><title><p>续篇</p></title><p>第二个普通正文。</p></section></body><body name="notes">');
    const value = parseFb2Book(bytes(source)), book = create(value);
    const normal = value.sections.findIndex(section => section.paragraphs.includes("第二个普通正文。"));
    const notes = value.sections.findIndex(section => section.paragraphs.some(text => text.includes("这是本地脚注内容")));
    expect(normal).toBeGreaterThan(0); expect(book.sections[normal].linear).not.toBe("no"); expect(book.sections[notes].linear).toBe("no");
  });
  it("真实固定View的Text端点CFI覆盖三个章节、emoji和跨inline文字", async () => {
    const book = create(), view = bridge.createView(); Object.assign(view, { book });
    for (const index of [0, 1, 2]) {
      const doc = await book.sections[index].createDocument(), maps = mapEpubDocument(doc, chapter(index), "[data-fb2-paragraph]");
      for (const map of maps) {
        const first = map.points[0], last = map.points.at(-1)!; const range = doc.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
        const resolved = view.resolveCFI(view.getCFI(index, range)), target = resolved.anchor(await book.sections[index].createDocument());
        expect(resolved.index).toBe(index); expect((target as Range).toString()).toBe(range.toString());
      }
    }
    expect(view.shadowRoot).toBeNull(); view.close();
  });
});

describe("CFI元素端点规范化专项复验", () => {
  function boundary(range: Range) { return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset, collapsed: range.collapsed, text: range.toString() }; }
  function pinnedGetCFI(view: ReturnType<FoliateBridge["createView"]>) {
    // WHY：取真实固定版View原型方法作对照，而非复制CFI算法或mock输出；应用包装仅是实例上的getCFI。
    return (Reflect.get(Object.getPrototypeOf(view), "getCFI") as typeof view.getCFI).bind(view);
  }
  it("元素端点只规范clone，原Range端点、原DOM、节点身份和URL归属均不变", async () => {
    const book = create(), doc = await book.sections[0].createDocument(), view = bridge.createView(); Object.assign(view, { book });
    const paragraph = doc.getElementById("source-one")!, node = paragraph.firstChild, range = doc.createRange(); range.selectNodeContents(paragraph);
    const before = boundary(range), html = doc.documentElement.outerHTML, urls = [...allocated.keys()];
    const setStart = vi.spyOn(range, "setStart"), setEnd = vi.spyOn(range, "setEnd"), collapse = vi.spyOn(range, "collapse");
    const observer = new MutationObserver(() => {}); observer.observe(doc.documentElement, { subtree: true, attributes: true, characterData: true, childList: true });
    try {
      const cfi = view.getCFI(0, range), restored = view.resolveCFI(cfi).anchor(await book.sections[0].createDocument());
      expect((restored as Range).toString()).toBe(before.text); expect(boundary(range)).toEqual(before);
      expect(setStart).not.toHaveBeenCalled(); expect(setEnd).not.toHaveBeenCalled(); expect(collapse).not.toHaveBeenCalled();
      expect(doc.documentElement.outerHTML).toBe(html); expect(paragraph.firstChild).toBe(node); expect(observer.takeRecords()).toEqual([]);
      expect([...allocated.keys()]).toEqual(urls); expect(revoked.size).toBe(0); expect(view.shadowRoot).toBeNull();
    } finally { observer.disconnect(); view.close(); }
  });
  it.each(["element-element", "element-text", "text-element"] as const)("%s端点跨strong/em与emoji时精确保留文本和UTF16边界", async mode => {
    const source = fixture.replace('<p id="source-one">重复正文用于验证版本定位。</p>', '<p id="source-one">甲😀<strong>重要<emphasis>概念</emphasis></strong><emphasis>尾😀</emphasis>后。</p>');
    const book = create(parseFb2Book(bytes(source))), doc = await book.sections[0].createDocument(), view = bridge.createView(); Object.assign(view, { book });
    const paragraph = doc.getElementById("source-one")!, range = doc.createRange(); range.selectNodeContents(paragraph);
    let expected = "甲😀重要概念尾😀后。";
    if (mode === "element-text") { range.setStart(paragraph, 1); range.setEnd(paragraph.childNodes[2].firstChild!, 3); expected = "重要概念尾😀"; }
    if (mode === "text-element") { range.setStart(paragraph.firstChild!, 1); range.setEnd(paragraph, 3); expected = "😀重要概念尾😀"; }
    const before = boundary(range), html = doc.documentElement.outerHTML;
    try {
      expect(range.toString()).toBe(expected); const cfi = view.getCFI(0, range), restored = view.resolveCFI(cfi).anchor(await book.sections[0].createDocument());
      expect((restored as Range).toString()).toBe(expected); expect(boundary(range)).toEqual(before); expect(doc.documentElement.outerHTML).toBe(html);
      expect((restored as Range).startContainer.nodeType).toBe(Node.TEXT_NODE); expect((restored as Range).endContainer.nodeType).toBe(Node.TEXT_NODE);
    } finally { view.close(); }
  });
  it("纯图片非折叠选区不扩成邻近正文，CFI与原始固定版行为相同", async () => {
    const book = create(), doc = await book.sections[0].createDocument(), view = bridge.createView(); Object.assign(view, { book });
    const range = doc.createRange(); range.selectNode(doc.querySelector("img")!); const before = boundary(range), html = doc.documentElement.outerHTML;
    try {
      expect(range.collapsed).toBe(false); expect(range.toString()).toBe(""); const baseline = pinnedGetCFI(view)(0, range), actual = view.getCFI(0, range);
      expect(actual).toBe(baseline); expect(boundary(range)).toEqual(before); expect(doc.documentElement.outerHTML).toBe(html);
      expect((view.resolveCFI(actual).anchor(await book.sections[0].createDocument()) as Range).toString()).toBe("");
    } finally { view.close(); }
  });
  it.each(["text", "element"] as const)("常规collapsed %s端点CFI与原始固定版一致，不改变原锚点", async kind => {
    const book = create(), doc = await book.sections[0].createDocument(), view = bridge.createView(); Object.assign(view, { book });
    const paragraph = doc.getElementById("source-one")!, range = doc.createRange(); range.setStart(kind === "text" ? paragraph.firstChild! : paragraph, kind === "text" ? 4 : 0); range.collapse(true);
    const before = boundary(range);
    try {
      const baseline = pinnedGetCFI(view)(0, range), cfi = view.getCFI(0, range); expect(cfi).toBe(baseline); expect(boundary(range)).toEqual(before);
      const restored = view.resolveCFI(cfi).anchor(await book.sections[0].createDocument()) as Range;
      expect(restored.collapsed).toBe(true); expect(restored.toString()).toBe(""); if (kind === "text") expect(restored.startOffset).toBe(4);
    } finally { view.close(); }
  });
  it("未提供Range时保留原有章节CFI，不人为创造文本范围", () => {
    const book = create(), view = bridge.createView(); Object.assign(view, { book });
    try { for (const index of [0, 1, 2]) { const actual = view.getCFI(index); expect(actual).toBe(pinnedGetCFI(view)(index)); expect(view.resolveCFI(actual).index).toBe(index); } }
    finally { view.close(); }
  });
});


describe("FB2分级目录闭环", () => {
  it("fixture嵌套小节和注释目录href均定位到对应section及真实heading", async () => {
    const book = create();
    for (const [sectionIndex, label, fragment] of [[0, "嵌套小节", "nested"], [2, "注释一", "note-one"]] as const) {
      const item = book.toc![sectionIndex].subitems!.find(child => child.label === label)!;
      expect(item.href).toBe(`fb2-v1/section-${sectionIndex}.xhtml#${fragment}`);
      const resolved = book.resolveHref!(item.href)!, doc = await book.sections[sectionIndex].createDocument(), target = resolved.anchor(doc) as Element;
      expect(resolved.index).toBe(sectionIndex); expect(target.id).toBe(fragment); expect(target.tagName.toLowerCase()).toBe("section");
      expect(target.querySelector("header h1")?.textContent).toBe(label); expect(book.getTOCFragment!(doc, fragment)).toBe(target);
      // WHY：TOC href按书根解析，previewEpubLink接收正文链接；正文中的同目标地址需要书根前导斜杠，避免重复章节目录。
      const preview = await previewEpubLink("/" + item.href, book.sections, sectionIndex, doc);
      expect(preview.index).toBe(sectionIndex); expect(preview.fragment).toBe(fragment); expect(preview.text).toContain(label);
    }
  });
  it("无ID小节自动目录ID稳定且避开真实ID，href能恢复到小节heading", async () => {
    const source = fixture.replace('<section id="nested">', "<section>").replace('id="chapter-two"', 'id="judu-fb2-section-0"');
    const first = create(parseFb2Book(bytes(source))), second = create(parseFb2Book(bytes(source)));
    const item = first.toc![0].subitems!.find(child => child.label === "嵌套小节")!, repeated = second.toc![0].subitems!.find(child => child.label === "嵌套小节")!;
    expect(item.href).toBe(repeated.href); const fragment = first.splitTOCHref!(item.href)[1];
    expect(fragment).toMatch(/^judu-fb2-section-\d+$/u); expect(fragment).not.toBe("judu-fb2-section-0");
    const resolved = first.resolveHref!(item.href)!, doc = await first.sections[resolved.index].createDocument(), target = resolved.anchor(doc) as Element;
    expect(resolved.index).toBe(0); expect(target.id).toBe(fragment); expect(target.querySelector("header h1")?.textContent).toBe("嵌套小节");
    const ids = (await Promise.all(first.sections.map(section => section.createDocument()))).flatMap(document => [...document.querySelectorAll("[id]")].map(element => element.id));
    expect(new Set(ids).size).toBe(ids.length); expect(ids).toContain("judu-fb2-section-0");
  });
  it("自动目录ID不加入原file引用目标，不能误恢复悬空原链接", () => {
    const source = fixture.replace('<section id="nested">', "<section>").replace("字符保真：", '<a l:href="#judu-fb2-section-0">悬空引用</a>字符保真：');
    expect(() => create(parseFb2Book(bytes(source)))).toThrow("FB2内部引用目标不存在");
    expect(allocated.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
});

