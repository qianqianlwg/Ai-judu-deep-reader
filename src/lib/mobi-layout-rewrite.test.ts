import { describe, expect, it, vi } from "vitest";
import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";
import { rewriteMobiResourceCss, rewriteMobiResourceMarkup } from "./mobi-layout-rewrite.mjs";
const uri = "kindle:embed:0001?mime=image/png", id = "mobi-resource-v1/1.png";
const replacement = () => vi.fn((value: string) => value.startsWith("kindle:flow:") ? "mobi-resource-v1/2.css" : id);
function attribute(html: string, name: string): string | undefined {
  const stack: DefaultTreeAdapterTypes.Node[] = [parseHtml(html)];
  while (stack.length) {
    const node = stack.pop()!;
    if ("attrs" in node) { const attr = node.attrs.find(item => item.name === name); if (attr) return attr.value; }
    if ("childNodes" in node) stack.push(...node.childNodes);
  }
}

describe("HTML资源引用与源码保真", () => {
  it("正文literal、注释、脚本、其他属性、实体和Unicode不改写", () => {
    const html = `\ufeff<!doctype html>\r\n<!-- ${uri} --><p title="${uri}" data-ref="${uri}">字面 ${uri} &amp; &#x1F600; 😀</p><script src="${uri}">globalThis.MOBI_EXECUTED=true; const s="${uri}";</script><IMG alt="&amp;😀" SRC = '${uri}' data-x="untouched">`;
    const replace = replacement();
    expect(rewriteMobiResourceMarkup(html, replace)).toBe(html.replace(`SRC = '${uri}'`, `SRC="${id}"`));
    expect(replace).toHaveBeenCalledExactlyOnceWith(uri); expect(Reflect.get(globalThis, "MOBI_EXECUTED")).toBeUndefined();
  });
  it.each(["src", "href", "xlink:href", "poster", "background", "data"])("资源属性%s可改写", name => {
    const replace = replacement(), html = `<div ${name}=${uri} other="${uri}">kindle:embed:0001</div>`;
    expect(rewriteMobiResourceMarkup(html, replace)).toBe(`<div ${name}="${id}" other="${uri}">kindle:embed:0001</div>`);
    expect(replace).toHaveBeenCalledExactlyOnceWith(uri);
  });
  it("head/body片段不添加包装，多个Unicode前后的patch不漂移", () => {
    for (const html of [`<link href="kindle:flow:2"><style>/*keep*/a { background: url(${uri}) }</style>`, `<body>😀<img src="${uri}"><img src="${uri}"></body>`]) {
      const output = rewriteMobiResourceMarkup(html, replacement());
      expect(output).not.toContain("<html>"); expect(output).not.toContain(uri); expect(output).toContain(id);
      expect(output.startsWith(html.startsWith("<body>") ? "<body>😀" : '<link href="mobi-resource-v1/2.css">')).toBe(true);
    }
  });
  it("SVG image/use属性改写，SVG text不变", () => {
    const html = `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><text>${uri} &amp;😀</text><image xlink:href="${uri}"/><use href="${uri}"/></svg>`;
    const replace = replacement();
    expect(rewriteMobiResourceMarkup(html, replace)).toBe(html.replace(`xlink:href="${uri}"`, `xlink:href="${id}"`).replace(`<use href="${uri}"`, `<use href="${id}"`));
    expect(replace).toHaveBeenCalledTimes(2);
  });
  it("实体解码一次，回调结果安全转义不二次解码", () => {
    const value = 'mobi-resource-v1/a&copy;😀"\'<>.png', replace = vi.fn(() => value);
    const result = rewriteMobiResourceMarkup('<img src="kindle&#58;embed&#58;0001&#63;mime=image/png" title="&amp;copy;">', replace);
    expect(replace).toHaveBeenCalledExactlyOnceWith(uri); expect(attribute(result, "src")).toBe(value);
    expect(result).toContain('title="&amp;copy;"'); expect(result).toContain("&amp;copy;😀&quot;&#39;&lt;&gt;");
    const doubled = '<img src="kindle&amp;#58;embed:0001">';
    expect(rewriteMobiResourceMarkup(doubled, replace)).toBe(doubled); expect(replace).toHaveBeenCalledTimes(1);
  });
  it("style属性通过CSS声明列表改写，content和实体语义保留", () => {
    const html = '<p style="content:&quot;kindle:embed:0001&quot;; background: url(&quot;kindle&#58;embed:0001&quot;); --note: &quot;&amp;copy;😀&quot;" title="&#38;">字面</p>';
    const replace = replacement(), output = rewriteMobiResourceMarkup(html, replace);
    expect(attribute(output, "style")).toBe(`content:"kindle:embed:0001"; background: url(${id}); --note: "&copy;😀"`);
    expect(output).toContain('title="&#38;">字面</p>'); expect(replace).toHaveBeenCalledExactlyOnceWith("kindle:embed:0001");
  });
  it("style文本除Url节点外不改，非CSS style类型原样保留", () => {
    const html = `<style>/*😀*/\n.a { content:"kindle:embed:0001"; background:url(${uri}) }\r\n</style>`;
    expect(rewriteMobiResourceMarkup(html, replacement())).toBe(html.replace(`url(${uri})`, `url(${id})`));
    const literal = `<style type="text/plain">${uri}</style>`;
    expect(rewriteMobiResourceMarkup(literal, replacement())).toBe(literal);
  });
  it("template引用可改写，noscript原始文本不猜成资源", () => {
    const html = `<template><img src="${uri}">${uri}</template><noscript><img src="${uri}"></noscript>`;
    expect(rewriteMobiResourceMarkup(html, replacement())).toBe(html.replace(`src="${uri}"`, `src="${id}"`));
  });
  it("无变化时不重序列化引号、大小写、CRLF和实体", () => {
    const html = '<!DOCTYPE HTML>\r\n<HEAD><TITLE>&amp;😀</TITLE></HEAD>\n<BODY><IMG SRC=external.png><p STYLE = \'content:"kindle:embed:x"\'>kindle:embed:x</p></BODY>';
    const replace = replacement(); expect(rewriteMobiResourceMarkup(html, replace)).toBe(html); expect(replace).not.toHaveBeenCalled();
    const same = '<img src=kindle:embed:x>'; expect(rewriteMobiResourceMarkup(same, value => value)).toBe(same);
  });
});

describe("CSS资源Url与String import语义", () => {
  it("url与@import两种形式改写，content和注释不改", () => {
    const css = `/*kindle:embed:0001*/\r\n@import url("kindle:flow:2?mime=text/css") screen;\n@import "kindle:flow:3";\n.a { content: 'kindle:embed:0001'; background: url(${uri}); }`;
    const replace = replacement();
    expect(rewriteMobiResourceCss(css, replace)).toBe(css.replace('url("kindle:flow:2?mime=text/css")', 'url(mobi-resource-v1/2.css)').replace(`url(${uri})`, `url(${id})`).replace('"kindle:flow:3"', 'url(mobi-resource-v1/2.css)'));
    expect(replace.mock.calls.map(call => call[0])).toEqual(["kindle:flow:2?mime=text/css", "kindle:flow:3", uri]);
  });
  it("内联声明、自定义属性和转义Url按AST语义处理", () => {
    const replace = replacement(), css = String.raw`--image: url(\6b indle:embed:0001); background:URL(","); content:"kindle:embed:0001";`;
    expect(rewriteMobiResourceCss(css, replace, true)).toBe(css.replace(String.raw`url(\6b indle:embed:0001)`, `url(${id})`));
    expect(replace).toHaveBeenCalledExactlyOnceWith("kindle:embed:0001");
  });
  it.each(["kindle:embed:A_01", "kindle:flow:a_01?mime=application/vnd.test+xml", "kindle:embed:1?mime=font/woff2"])("合法URI传给回调：%s", value => {
    const replace = replacement(); rewriteMobiResourceMarkup(`<img src="${value}">`, replace);
    rewriteMobiResourceCss(`a{background:url("${value}")}`, replace);
    expect(replace).toHaveBeenCalledTimes(2); expect(replace).toHaveBeenCalledWith(value);
  });
  it.each([
    "KINDLE:embed:1", "kindle:pos:1", "kindle:embed:", "kindle:embed:a-b", "kindle:embed:a.b",
    "kindle:embed:1?mime=text", "kindle:embed:1?mime=text/", "kindle:embed:1#x", "kindle:embed:1?other=x",
    "kindle:embed:1?mime=text/css&extra=x", " kindle:embed:1", "kindle:embed:1 ", "https://example.invalid/a.png", "mobi-resource-v1/a.png",
  ])("非精确URI原样保留：%s", value => {
    const html = `<img src="${value}">`, css = `a{background:url("${value}")}`, replace = replacement();
    expect(rewriteMobiResourceMarkup(html, replace)).toBe(html); expect(rewriteMobiResourceCss(css, replace)).toBe(css); expect(replace).not.toHaveBeenCalled();
  });
  it("URI尾换行不因正则$边界宽放", () => {
    const html = '<img src="kindle:embed:1\n">', replace = replacement();
    expect(rewriteMobiResourceMarkup(html, replace)).toBe(html); expect(replace).not.toHaveBeenCalled();
  });
  it("回调结果CSS语义转义，不产生提前结束style的标记", () => {
    const output = rewriteMobiResourceMarkup(`<style>a{background:url(${uri})}</style>`, () => 'id)</style><script>&"😀');
    expect(output.match(/<\/style>/gu)).toHaveLength(1); expect(output).not.toContain("<script>"); expect(output).toContain("\\3c /style>");
  });
});

describe("错误上抛和预算", () => {
  it("回调同一异常向上传递，包括嵌套style", () => {
    const error = new Error("resource missing"), replace = () => { throw error; };
    for (const html of [`<img src="${uri}">`, `<p style="background:url(${uri})">`, `<style>a{background:url(${uri})}</style>`]) expect(() => rewriteMobiResourceMarkup(html, replace)).toThrow(error);
    expect(() => rewriteMobiResourceCss(`a{background:url(${uri})}`, replace)).toThrow(error);
  });
  it("CSS解析错误不静默吞掉", () => {
    const css = 'a{color red}';
    expect(() => rewriteMobiResourceCss(css, replacement())).toThrow();
    expect(() => rewriteMobiResourceMarkup(`<style>${css}</style>`, replacement())).toThrow();
  });
  it("上游可恢复CSS不额外自创语法限制，未发生替换时仍原样保留", () => {
    const css = 'a{background:url("unterminated)}', replace = replacement();
    expect(rewriteMobiResourceCss(css, replace)).toBe(css); expect(replace).not.toHaveBeenCalled();
  });
  it("不执行脚本、不调用网络，也不是sanitize", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const html = '<script>fetch("https://example.invalid")</script><img src="https://example.invalid/a.png" onload="danger()">';
      expect(rewriteMobiResourceMarkup(html, replacement())).toBe(html);
      expect(rewriteMobiResourceCss('@import url(https://example.invalid/a.css);', replacement())).toBe('@import url(https://example.invalid/a.css);');
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("运行时验证输入、回调和上下文类型", () => {
    expect(() => rewriteMobiResourceMarkup(null as unknown as string, replacement())).toThrow(/输入/u);
    expect(() => rewriteMobiResourceCss("", null as unknown as (uri: string) => string)).toThrow(/输入/u);
    expect(() => rewriteMobiResourceCss("", replacement(), 1 as unknown as boolean)).toThrow(/上下文/u);
    expect(() => rewriteMobiResourceMarkup(`<img src="${uri}">`, () => 1 as unknown as string)).toThrow(/回调/u);
  });
  it("HTML/CSS输入输出长度受限", () => {
    expect(() => rewriteMobiResourceMarkup("x".repeat(20_000_001), replacement())).toThrow(/长度/u);
    expect(() => rewriteMobiResourceCss("x".repeat(2 * 1024 * 1024 + 1), replacement())).toThrow(/长度/u);
    expect(() => rewriteMobiResourceMarkup(`<img src="${uri}">`, () => "x".repeat(20_000_001))).toThrow(/回调/u);
    expect(() => rewriteMobiResourceCss(`a{background:url(${uri})}`, () => "x".repeat(2 * 1024 * 1024))).toThrow(/输出/u);
  });
  it("节点与patch有限，HTML内嵌CSS共享预算", () => {
    expect(() => rewriteMobiResourceMarkup("<!--x-->".repeat(100_001), replacement())).toThrow(/节点/u);
    expect(() => rewriteMobiResourceMarkup(`<img src="${uri}">`.repeat(10_001), replacement())).toThrow(/patch/u);
    expect(() => rewriteMobiResourceMarkup(`<i style="background:url(${uri})"></i>`.repeat(5_001), replacement())).toThrow(/patch/u);
  }, 20_000);
});
it('String import按资源语义处理，但外部import及content字符串保持原样',()=>{
 const replace=vi.fn(()=> 'mobi-resource-v1/theme.css');
 const input='@import "kindle:flow:0001?mime=text/css" layer(book) screen; @import "https://invalid.example/a.css"; p{content:"kindle:flow:0001?mime=text/css"}';
 expect(rewriteMobiResourceCss(input,replace)).toBe(input.replace('"kindle:flow:0001?mime=text/css"','url(mobi-resource-v1/theme.css)'));expect(replace).toHaveBeenCalledExactlyOnceWith('kindle:flow:0001?mime=text/css');
});
