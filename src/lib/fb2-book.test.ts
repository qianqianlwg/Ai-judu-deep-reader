// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFb2Book, visibleText, type Fb2Node, type Fb2Book } from "./fb2-book";
import { FB2_NAMESPACE } from "./fb2-xml";
const XLINK = "http://www.w3.org/1999/xlink";
const bytes = (value: string) => new Uint8Array(Buffer.from(value, "utf8"));
const metadata = '<description><title-info><book-title>书名 &lt;公式&gt; 😀</book-title><author><first-name>Иван</first-name><middle-name>Иванович</middle-name><last-name>Иванов</last-name></author><author><nickname>笔名</nickname></author><lang>zh-CN</lang></title-info></description>';
function bookXml(body = "<body><section><p>正文</p></section></body>", extra = "", description = metadata) {
  return `<FictionBook xmlns="${FB2_NAMESPACE}" xmlns:l="${XLINK}">${description}${body}${extra}</FictionBook>`;
}
function book(body: string, extra = "") { return parseFb2Book(bytes(bookXml(body, extra))); }
type ElementNode = Exclude<Fb2Node, string>;
function elements(nodes: readonly Fb2Node[]): ElementNode[] { return nodes.flatMap(node => typeof node === "string" ? [] : [node, ...elements(node.children)]); }
function normalized(text: string) { return text.replace(/\s+/gu, " ").trim(); }
function assertSourceProjection(model: Fb2Book) {
  for (const section of model.sections) {
    const indexed = elements(section.nodes).filter(node => node.attributes["data-fb2-paragraph"] !== undefined);
    expect(indexed.map(node => node.attributes["data-fb2-paragraph"])).toEqual(section.paragraphs.map((_, i) => String(i)));
    expect(indexed.map(node => normalized(visibleText(node)))).toEqual(section.paragraphs);
    const render = (node: Fb2Node): Node => {
      if (typeof node === "string") return document.createTextNode(node);
      const el = document.createElement(node.tag); for (const [key, value] of Object.entries(node.attributes)) el.setAttribute(key, value);
      el.append(...node.children.map(render)); return el;
    };
    // WHY：此处独立投影模型到离线DOM，只验证canonical与模型来源；不使用主任务formatter/loader或真实浏览器。
    const root = document.createElement("section"); root.append(...section.nodes.map(render));
    expect(Array.from(root.querySelectorAll("[data-fb2-paragraph]"), el => normalized(el.textContent ?? ""))).toEqual(section.paragraphs);
  }
}
// 由本地内存像素生成的1x1图，固定字节fixture，不依赖网络或图片解码器。
const imageBytes = {
  "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "image/jpeg": "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z",
  "image/gif": "R0lGODlhAQABAIAAAExpcf///yH5BAUAAAAALAAAAAABAAEAAAICTAEAOw==",
  "image/webp": "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=",
};
const binary = (id = "pic", type = "image/png", content = imageBytes["image/png"]) => `<binary id="${id}" content-type="${type}">${content}</binary>`;
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("FB2模型验收禁止联网"); })); vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("FB2共享正文模型和来源定位", () => {
  it("metadata标题作者语言解码正确，不把元数据混成正文", () => {
    const model = book("<body><section><title><p>章节一</p></title><p>正文</p></section></body>");
    expect(model).toMatchObject({ title: "书名 <公式> 😀", author: "Иван Иванович Иванов、笔名", language: "zh-CN" });
    expect(model.sections[0]).toMatchObject({ title: "章节一", href: "fb2-v1/section-0.xhtml", paragraphs: ["章节一", "正文"] }); assertSourceProjection(model);
  });
  it("元数据缺省明确返回空标题/未知作者，不以正文第一句冒充书名", () => {
    const model = parseFb2Book(bytes(bookXml("<body><section><p>第一句</p></section></body>", "", "")));
    expect(model.title).toBe(""); expect(model.author).toBe("未知作者"); expect(model.language).toBe(""); expect(model.sections[0].paragraphs).toEqual(["第一句"]);
  });
  it("合法xmlns前缀覆盖metadata/正文/image/binary和XLink，不能只支持默认命名空间", () => {
    const source = bookXml('<body><section id="s"><title><p>标题</p></title><p>正文 <a l:href="#s">回链</a></p><image l:href="#pic"/></section></body>', binary());
    const prefixed = source.replace(/<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/gu, "<$1f:$2").replace(`xmlns="${FB2_NAMESPACE}"`, `xmlns:f="${FB2_NAMESPACE}"`);
    const model = parseFb2Book(bytes(prefixed)); expect(model).toEqual(parseFb2Book(bytes(source))); assertSourceProjection(model);
  });
  it("多个正文分章和重复段落保留每次出现及独立locator，不按文字去重", () => {
    const model = book("<body><title><p>总标题</p></title><section><title><p>第一章</p></title><p>重复</p><p>重复</p></section><section><title><p>第二章</p></title><p>重复</p></section></body>");
    expect(model.sections.map(s => s.href)).toEqual(["fb2-v1/section-0.xhtml", "fb2-v1/section-1.xhtml", "fb2-v1/section-2.xhtml"]);
    expect(model.sections.map(s => s.paragraphs)).toEqual([["总标题"], ["第一章", "重复", "重复"], ["第二章", "重复"]]); assertSourceProjection(model);
  });
  it("嵌套section正文保留次序，字体样式不改变canonical字符", () => {
    const model = book("<body><section><p>甲<strong>乙</strong><emphasis>丙😀</emphasis></p><section><title><p>小节</p></title><p>丁<sup>2</sup><sub>n</sub><code>x</code></p></section></section></body>");
    expect(model.sections.flatMap(s => s.paragraphs)).toEqual(["甲乙丙😀", "小节", "丁2nx"]); assertSourceProjection(model);
  });
  it("CDATA prefix/suffix和真实符号保持精确，不丢失尖括号/实体样文字", () => {
    const model = book('<body><section><p>prefix<![CDATA[<x>&amp;😀]]><strong>中</strong>suffix</p><p>&lt;tag&gt;&amp; &amp;lt;</p></section></body>');
    expect(model.sections[0].paragraphs).toEqual(["prefix<x>&amp;😀中suffix", "<tag>& &lt;"]); assertSourceProjection(model);
  });
  it("数字实体进入共享模型须与实际字符相同，服务器和DOM不可各自解释", () => {
    const model = book('<body><section><p>&#65;&#x1F600;&#x4E2D;</p></section></body>');
    expect(model.sections[0].paragraphs).toEqual(["A😀中"]); assertSourceProjection(model);
  });
  it("表格、诗歌、引用、作者署名和小标题均进入索引且顺序不变", () => {
    const model = book('<body><section><subtitle>小标题</subtitle><poem><stanza><v>诗一</v><v>诗二</v></stanza><text-author>诗人</text-author></poem><cite><p>引文</p><text-author>作者</text-author></cite><table><tr><th>表头</th><td colspan="2" rowspan="1" align="center">单元<emphasis>格</emphasis></td></tr></table></section></body>');
    expect(model.sections[0].paragraphs).toEqual(["小标题", "诗一", "诗二", "诗人", "引文", "作者", "表头", "单元格"]);
    expect(elements(model.sections[0].nodes).find(n => n.tag === "td")?.attributes).toMatchObject({ colspan: "2", rowspan: "1", class: "fb2-td fb2-align-center" }); assertSourceProjection(model);
  });
  it("脚注引用解析到notes节及原ID，正文和注释同文也不混淆", () => {
    const model = book('<body><section id="main"><p>重复<a type="note" l:href="#n1">⑴</a></p></section></body><body name="notes"><section id="n1"><title><p>注释一</p></title><p>重复</p></section></body>');
    expect(model.sections[1].linear).toBe("no"); expect(model.sections[1].paragraphs).toEqual(["注释一", "重复"]);
    const link = elements(model.sections[0].nodes).find(n => n.tag === "a")!;
    expect(new URL(link.attributes.href, "https://fb2.test/" + model.sections[0].href).href).toBe("https://fb2.test/" + model.sections[1].href + "#n1"); expect(link.attributes["epub:type"]).toBe("noteref"); assertSourceProjection(model);
  });
  it("正文普通内部回链保留源ID，不以文字相似猜目标", () => {
    const model = book('<body><section id="甲"><p>同文</p></section><section><p>同文<a l:href="#甲">回链</a></p></section></body>');
    const href = elements(model.sections[1].nodes).find(n => n.tag === "a")!.attributes.href; expect(new URL(href, "https://fb2.test/" + model.sections[1].href).href).toBe("https://fb2.test/" + model.sections[0].href + "#%E7%94%B2");
  });
  it("同字节Node Buffer和浏览器Uint8Array结果完全一致，重复解析locator稳定", () => {
    const source = Buffer.from(bookXml('<body><section><p>重复😀</p><p>重复😀</p></section></body>')), a = parseFb2Book(source), b = parseFb2Book(new window.Uint8Array(source));
    expect(a).toEqual(b); expect(parseFb2Book(source)).toEqual(a); assertSourceProjection(a);
  });
  it("UTF16BE实际字节与UTF8得到同样共享模型和locator", () => {
    const source = bookXml('<body><section><p>甲😀&lt;公式&gt;</p></section></body>');
    const utf16 = Buffer.concat([Buffer.from([254, 255]), Buffer.from(source, "utf16le").swap16()]);
    expect(parseFb2Book(utf16)).toEqual(parseFb2Book(bytes(source)));
  });
});

describe("FB2嵌入图片和合法ID作用域", () => {
  it.each(Object.entries(imageBytes))("嵌入%s完整字节保留，前后正文不丢失且不请求资源", (type, base64) => {
    const model = book('<body><section><p>前文</p><image l:href="#pic" alt="替代文本" title="图片标题"/><p>后文</p></section></body>', binary("pic", type, base64));
    expect(model.images).toHaveLength(1); expect(model.images[0]).toEqual({ id: "pic", type, bytes: new Uint8Array(Buffer.from(base64, "base64")) });
    const image = elements(model.sections[0].nodes).find(n => n.tag === "img")!;
    expect(image.attributes).toMatchObject({ "data-fb2-image": "pic", alt: "替代文本", title: "图片标题" }); expect(image.attributes.src).toBeUndefined();
    expect(model.sections[0].paragraphs).toEqual(["前文", "后文"]); assertSourceProjection(model); expect(fetch).not.toHaveBeenCalled();
  });
  it("合法同ID binary与image分别作为资源和正文定位，不能全局去重误拒绝", () => {
    const model = book('<body><section><p>前文<a l:href="#pic">图</a></p><image id="pic" l:href="#pic"/><p>后文</p></section></body>', binary());
    expect(model.images[0].id).toBe("pic"); expect(elements(model.sections[0].nodes).find(n => n.tag === "img")?.attributes.id).toBe("pic");
    const href = elements(model.sections[0].nodes).find(n => n.tag === "a")!.attributes.href; expect(new URL(href, "https://fb2.test/" + model.sections[0].href).href).toBe("https://fb2.test/" + model.sections[0].href + "#pic"); assertSourceProjection(model);
  });
  it("合法base64空白折行不改变二进制内容，多次image引用不复制资源", () => {
    const content = imageBytes["image/png"].match(/.{1,16}/gu)!.join("\r\n\t ");
    const model = book('<body><section><p>正文</p><image l:href="#pic"/><image l:href="#pic"/></section></body>', binary("pic", "image/png", content));
    expect(model.images).toHaveLength(1); expect(model.images[0].bytes).toEqual(new Uint8Array(Buffer.from(imageBytes["image/png"], "base64"))); expect(elements(model.sections[0].nodes).filter(n => n.tag === "img")).toHaveLength(2);
  });
  it("同binary ID重复必须拒绝，不覆盖首张图", () => {
    expect(() => book('<body><section><p>正文</p></section></body>', binary() + binary())).toThrow(/图片ID.*重复/);
  });
  it.each(["", "bad!", "AAAA=", "AA", "AAAA===="])("损坏base64 %j 明确失败", content => {
    expect(() => book('<body><section><p>正文</p></section></body>', binary("pic", "image/png", content))).toThrow(/base64/);
  });
  it("MIME与实际签名不一致拒绝", () => {
    expect(() => book('<body><section><p>正文</p></section></body>', binary("pic", "image/jpeg", imageBytes["image/png"]))).toThrow(/类型不一致/);
  });
  it.each(["image/svg+xml", "text/html", "application/javascript"])("不支持的主动格式%s拒绝，不偷偷丢图片", type => {
    expect(() => book('<body><section><p>正文</p></section></body>', binary("pic", type, Buffer.from("<svg onload='alert(1)'/>").toString("base64")))).toThrow(/图片格式.*不支持/); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["https://example.invalid/a.png", "file:///private/a.png", "data:image/png;base64,AA==", "#missing"])("外部或缺失图片%s拒绝，不能原版成功但正文缺图", target => {
    expect(() => book(`<body><section><p>前文</p><image l:href="${target}"/><p>后文</p></section></body>`)).toThrow(/图片必须引用/); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("FB2结构与主动内容明确失败，不静默丢正文", () => {
  it.each(["javascript:alert(1)", "data:text/html,evil", "file:///private", "vbscript:msgbox(1)"])("主动链接%s拒绝且不执行", target => {
    expect(() => book(`<body><section><p>正文<a l:href="${target}">引用</a></p></section></body>`)).toThrow(/协议不允许/); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it.each(["https://example.invalid/path?q=x&amp;y=z", "http://example.invalid/", "mailto:reader@example.invalid"])("允许的外部链接%s仅保留地址，不访问", target => {
    const model = book(`<body><section><p>正文<a l:href="${target}">引用</a></p></section></body>`);
    expect(elements(model.sections[0].nodes).find(n => n.tag === "a")?.attributes.href).toBe(target.replace(/&amp;/gu, "&")); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it.each(['l:href="#missing"', 'href="#s"', 'xmlns:z="urn:not-xlink" z:href="#s"'])("缺失或非XLink引用%s明确失败", attribute => {
    expect(() => book(`<body><section id="s"><p>正文<a ${attribute}>引用</a></p></section></body>`)).toThrow(/引用目标不存在|XLink目标/);
  });
  it("同书正文重复ID拒绝，即使文本相同", () => {
    expect(() => book('<body><section id="same"><p>重复</p></section><section id="same"><p>重复</p></section></body>')).toThrow(/正文ID重复/);
  });
  it("事件属性不进入共享HTML节点，原文仍保留", () => {
    const model = book('<body><section><p onclick="alert(1)" style="background:url(https://example.invalid)">正文</p></section></body>');
    const p = elements(model.sections[0].nodes).find(n => n.tag === "p")!; expect(p.attributes.onclick).toBeUndefined(); expect(p.attributes.style).toBeUndefined(); expect(visibleText(p)).toBe("正文"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["<body><section><p>前文</p><unknown>不能丢正文</unknown><p>后文</p></section></body>", '<body><section><p>前文</p><x:p xmlns:x="urn:foreign">不能丢正文</x:p></section></body>', "<body>不能丢正文<section><p>正文</p></section></body>"])("未知正文结构必须整体失败而非局部成功", body => {
    expect(() => book(body)).toThrow();
  });
  it("section中裸文字不能只显示而遗漏canonical，须明确拒绝非法结构", () => {
    expect(() => book('<body><section>被遗漏正文<p>保留正文</p></section></body>')).toThrow();
  });
  it("image内部非法文字不能被无声丢掉", () => {
    expect(() => book('<body><section><p>前文</p><image l:href="#pic">被丢掉正文</image><p>后文</p></section></body>', binary())).toThrow();
  });
  it("非注释的第二个body不能被标成linear=no而从正常阅读流排除", () => {
    const model = book('<body name="part-one"><section><p>第一卷</p></section></body><body name="part-two"><section><p>第二卷</p></section></body>');
    expect(model.sections.map(s => s.paragraphs)).toEqual([["第一卷"], ["第二卷"]]); expect(model.sections[1].linear).not.toBe("no"); assertSourceProjection(model);
  });
  it.each(["0", "-1", "1.5", "257", "NaN"])("非法表格跨度%s不能改变结构", colspan => {
    expect(() => book(`<body><section><table><tr><td colspan="${colspan}">正文</td></tr></table></section></body>`)).toThrow(/跨度无效/);
  });
  it("正文为空或缺body拒绝", () => {
    expect(() => book("")).toThrow(/body缺失/); expect(() => book('<body><section><p> \n </p></section></body>')).toThrow(/没有可阅读正文/);
  });
  it("超过256个body或4096个章节明确拒绝，不截断导入", () => {
    expect(() => book("<body><section><p>正文</p></section></body>".repeat(257))).toThrow(/body.*超限/);
    expect(() => book("<body>" + "<section><p>正文</p></section>".repeat(4097) + "</body>")).toThrow(/章节.*超限/);
  }, 10000);
});

