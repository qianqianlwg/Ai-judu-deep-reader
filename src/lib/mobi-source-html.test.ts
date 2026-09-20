import { describe, expect, it, vi } from "vitest";
import { indexMobiSourceHtml, type MobiSourcePoint } from "./mobi-source-html.mjs";
import { EntityDecoder } from "entities/decode";

const textPoint = (path: number[], text: string, offset: number): MobiSourcePoint => ({ kind: "text", path, text, offset });
describe("真实body childNodes路径与源码位置", () => {
  it("保留空白/注释索引，无id与重复id同文不混淆", () => {
    const html = '<body>\n<!--保留--><p id="same">重复😀</p> gap <p id="same">重复😀</p><p>重复😀</p></body>';
    const index = indexMobiSourceHtml(html), starts = [...html.matchAll(/重复😀/gu)].map(match => match.index);
    expect(starts.map(start => index.locate(start))).toEqual([textPoint([2, 0], "重复😀", 0), textPoint([4, 0], "重复😀", 0), textPoint([5, 0], "重复😀", 0)]);
    expect(index.locate(html.indexOf('<p id="same">'))).toEqual({ kind: "element", path: [2], tag: "p", offset: 0 });
    for (const start of starts) expect(index.matches(index.locate(start))).toBe(true);
    expect(index.locate(html.indexOf("保留"))).toBeNull();
  });
  it("只有startTag起点可定位，属性/标签内部不猜成正文", () => {
    const html = '<P data-x="正文😀" class=x>正文😀</P>', index = indexMobiSourceHtml(html), content = html.indexOf(">") + 1;
    expect(index.locate(0)).toEqual({ kind: "element", path: [0], tag: "p", offset: 0 });
    for (let offset = 1; offset < content; offset++) expect(index.locate(offset)).toBeNull();
    expect(index.locate(content)).toEqual(textPoint([0, 0], "正文😀", 0));
    const endTag = html.indexOf("</P>");
    expect(index.locate(endTag)).toEqual(textPoint([0, 0], "正文😀", 4));
    for (let offset = endTag + 1; offset < html.length; offset++) expect(index.locate(offset)).toBeNull();
  });
  it("真实body起点用空path，隐式body不虚构源码位置", () => {
    const explicit = indexMobiSourceHtml('<body class="book">正文</body>');
    const point: MobiSourcePoint = { kind: "element", path: [], tag: "body", offset: 0 };
    expect(explicit.locate(0)).toEqual(point); expect(explicit.matches(point)).toBe(true);
    expect(indexMobiSourceHtml("正文").matches(point)).toBe(false);
    expect(indexMobiSourceHtml("正文").locate(0)).toEqual(textPoint([0], "正文", 0));
  });
  it("文本末尾/EOF可定位，相邻真实元素优先，隐藏元素起点不回退", () => {
    const html = '<body>甲<b>乙</b>丙<script>literal</script>丁', index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("<b>"))).toEqual({ kind: "element", path: [1], tag: "b", offset: 0 });
    expect(index.locate(html.indexOf("</b>"))).toEqual(textPoint([1, 0], "乙", 1));
    expect(index.locate(html.indexOf("<script>"))).toBeNull();
    expect(index.locate(html.length)).toEqual(textPoint([4], "丁", 1));
    expect(index.locate(html.length + 1)).toBeNull();
  });
  it("返回path不是共享可变数组，调用方改动不污染缓存", () => {
    const index = indexMobiSourceHtml("<p>字</p>"), point = index.locate(3)!;
    point.path[0] = 99; expect(index.locate(3)).toEqual(textPoint([0, 0], "字", 0)); expect(index.matches(point)).toBe(false);
  });
});

describe("完整解码后的精确UTF16边界", () => {
  it("实体/CRLF/代理对只有整段起止可定位；双码点实体不拆分", () => {
    const atoms = [["甲", "甲"], ["&amp;", "&"], ["\r\n", "\n"], ["😀", "😀"], ["&NotEqualTilde;", "≂̸"], ["&#13;", "\r"], ["\n", "\n"], ["&#x1F600;", "😀"], ["尾", "尾"]];
    const raw = atoms.map(([source]) => source).join(""), text = atoms.map(([, decoded]) => decoded).join(""), index = indexMobiSourceHtml(`<p>${raw}</p>`);
    let source = 3, offset = 0;
    for (const [encoded, decoded] of atoms) {
      expect(index.locate(source)).toEqual(textPoint([0, 0], text, offset));
      for (let inner = 1; inner < encoded.length; inner++) expect(index.locate(source + inner)).toBeNull();
      source += encoded.length; offset += decoded.length;
    }
    expect(index.locate(source)).toEqual(textPoint([0, 0], text, text.length));
    expect(index.matches(index.locate(source))).toBe(true);
  });
  it.each([
    ["&amp", "&", 4], ["&copy xyz", "© xyz", 5], ["&notit;", "¬it;", 4], ["&#65", "A", 4],
    ["&#x41;X", "AX", 6], ["&#x80;", "€", 6], ["&#xD800;", "�", 8], ["&#0;", "�", 4],
  ])("按Legacy正文语义解码%s，不独立解码半个实体", (raw, text, consumed) => {
    const index = indexMobiSourceHtml(`<p>${raw}</p>`);
    expect(index.locate(3)).toEqual(textPoint([0, 0], text, 0));
    for (let inner = 1; inner < consumed; inner++) expect(index.locate(3 + inner)).toBeNull();
    expect(index.locate(3 + consumed)).toEqual(textPoint([0, 0], text, 1));
  });
  it("未知/不完整实体仍是普通原文，&amp;不做二次解码", () => {
    const raw = "&bogus; &#xZ; &amp;amp;", text = "&bogus; &#xZ; &amp;", index = indexMobiSourceHtml(`<p>${raw}</p>`);
    for (let i = 0; i < raw.indexOf("&amp;" ); i++) expect(index.locate(3 + i)).toEqual(textPoint([0, 0], text, i));
    expect(index.locate(3 + raw.length)).toEqual(textPoint([0, 0], text, text.length));
  });
  it("完整保留换行，不trim；pre首个被解析器丢弃的换行无映射", () => {
    const raw = "\rX\nY\r\nZ", index = indexMobiSourceHtml(`<p>${raw}</p>`);
    expect(index.locate(3)).toEqual(textPoint([0, 0], "\nX\nY\nZ", 0));
    expect(index.locate(4)).toEqual(textPoint([0, 0], "\nX\nY\nZ", 1));
    const pre = "<pre>\r\n内容</pre>", preIndex = indexMobiSourceHtml(pre);
    expect(preIndex.locate(5)).toBeNull(); expect(preIndex.locate(6)).toBeNull();
    expect(preIndex.locate(7)).toEqual(textPoint([0, 0], "内容", 0));
  });
  it.each(["a\0b", "a\ud800b", "a\udc00b"])("非法原始字符%s不猜测偏移", raw => {
    const index = indexMobiSourceHtml(`<p>${raw}</p>`);
    for (let offset = 3; offset <= 3 + raw.length; offset++) expect(index.locate(offset)).toBeNull();
  });
  it("同一节点重复定位复用完整解码缓存，且顺序不影响结果", () => {
    const index = indexMobiSourceHtml("<p>A&amp;B😀C</p>");
    const decode = vi.spyOn(EntityDecoder.prototype, "startEntity");
    try {
      for (let i = 0; i < 500; i++) {
        expect(index.locate(9)).toEqual(textPoint([0, 0], "A&B😀C", 2));
        expect(index.locate(5)).toBeNull(); expect(index.locate(3)).toEqual(textPoint([0, 0], "A&B😀C", 0));
      }
      expect(decode).toHaveBeenCalledOnce();
    } finally { decode.mockRestore(); }
  });
});

describe("非正文和解析器重排", () => {
  it.each(["script", "style", "template", "noscript", "iframe", "textarea", "xmp", "plaintext"])("排除%s及后代", tag => {
    const html = `<body><${tag}>独有正文</${tag}></body>`, index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf(`<${tag}>`))).toBeNull(); expect(index.locate(html.indexOf("独有正文"))).toBeNull();
    expect(index.matches(textPoint([0, 0], "独有正文", 0))).toBe(false);
  });
  it.each(["hidden", 'hidden="false"', "inert", 'aria-hidden=" TRUE "', 'style="display: none"', 'style="color:red; DISPLAY : none !important;"', 'style="visibility: collapse"', 'style="visibility:hidden"', 'style="content-visibility: hidden"', 'style="display:/**/none"', 'style="d\\69splay:none"'])('排除隐藏祖先%s', attributes => {
    const html = `<body><div ${attributes}><p>独有正文</p></div></body>`, index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("<p>"))).toBeNull(); expect(index.locate(html.indexOf("独有正文"))).toBeNull();
    expect(index.matches(textPoint([0, 0, 0], "独有正文", 0))).toBe(false);
  });
  it("head/html隐藏祖先排除，未隐藏样式及aria-hidden=false不误丢", () => {
    const html = '<head><title>头文字</title></head><body><p style="display:block" aria-hidden="false">正文</p></body>', index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("头文字"))).toBeNull(); expect(index.locate(html.indexOf("正文"))).not.toBeNull();
    const hidden = '<html hidden><body><p>正文</p></body></html>';
    expect(indexMobiSourceHtml(hidden).locate(hidden.indexOf("正文"))).toBeNull();
  });
  it("明确拒绝SVG/MathML，包括嵌入foreignObject中的HTML", () => {
    for (const html of ['<svg><text>向量正文</text><foreignObject><p>HTML</p></foreignObject></svg>', '<math><mi>数学</mi></math>']) {
      const index = indexMobiSourceHtml(html); for (let i = 0; i <= html.length; i++) expect(index.locate(i)).toBeNull();
      expect(index.matches({ kind: "element", path: [0], tag: html.startsWith("<svg") ? "svg" : "math", offset: 0 })).toBe(false);
    }
  });
  it("foster-parent合并跨度包含其他标签时拒绝，不就近猜同文", () => {
    const html = '<table>前<tr><td>中</td></tr>后</table><p>前后</p>', index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("前"))).toBeNull(); expect(index.locate(html.indexOf("后"))).toBeNull();
    expect(index.matches(textPoint([0], "前后", 0))).toBe(false);
    const last = html.lastIndexOf("前后"); expect(index.locate(last)).toEqual(textPoint([2, 0], "前后", 0));
  });
  it("自动tbody保留真实DOM索引，无source location的元素不虚构起点", () => {
    const html = '<table><tr><td>正文</td></tr></table>', index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("正文"))).toEqual(textPoint([0, 0, 0, 0, 0], "正文", 0));
    expect(index.matches({ kind: "element", path: [0, 0], tag: "tbody", offset: 0 })).toBe(false);
  });
  it("格式修复后的重建DOM用真实路径，生成的克隆元素不猜源码起点", () => {
    const html = '<b>1<p>2</b>3', index = indexMobiSourceHtml(html);
    expect(index.locate(html.indexOf("2"))).toEqual(textPoint([1, 0, 0], "2", 0));
    expect(index.matches({ kind: "element", path: [1, 0], tag: "b", offset: 0 })).toBe(false);
  });
});

describe("改写后point验证与严格运行时边界", () => {
  it("资源属性变化不影响同path的全文/元素验证，不能只比前缀或重复字", () => {
    const html = '<p id="dup" data-x="kindle:embed:1">完整😀正文</p><p id="dup">另一个正文</p>', original = indexMobiSourceHtml(html);
    const point = original.locate(html.indexOf("完整"))!, element = original.locate(0)!;
    const rewritten = indexMobiSourceHtml(html.replace("kindle:embed:1", "mobi-resource-v1/long-file-name.png"));
    expect(rewritten.matches(point)).toBe(true); expect(rewritten.matches(element)).toBe(true);
    expect(indexMobiSourceHtml(html.replace("完整😀正文", "完整😀正文多一字")).matches(point)).toBe(false);
    expect(indexMobiSourceHtml(html.replace("<p", "<div").replace("</p>", "</div>")).matches(element)).toBe(false);
    expect(indexMobiSourceHtml(html.replace('<p id="dup"', '<p hidden id="dup"')).matches(point)).toBe(false);
  });
  it.each([undefined, null, {}, [], "point", 0,
    { kind: "text", path: [0, 0], text: "A😀B" },
    { kind: "text", path: [0, 0], text: "A😀B", offset: -1 },
    { kind: "text", path: [0, 0], text: "A😀B", offset: 2 },
    { kind: "text", path: [0, 0], text: "A😀B", offset: 5 },
    { kind: "text", path: [0, 0], text: "A😀B", offset: 1.5 },
    { kind: "text", path: [0, 0], text: "A😀B", offset: NaN },
    { kind: "text", path: [0, 0], text: "A😀B", offset: "1" },
    { kind: "text", path: [-1], text: "A😀B", offset: 0 },
    { kind: "text", path: [999], text: "A😀B", offset: 0 },
    { kind: "text", path: [0, 0, 0], text: "A😀B", offset: 0 },
    { kind: "text", path: [0, "0"], text: "A😀B", offset: 0 },
    { kind: "text", path: [0, NaN], text: "A😀B", offset: 0 },
    { kind: "text", path: new Array(1), text: "A😀B", offset: 0 },
    { kind: "text", path: [0, 0], text: "A😀B", offset: 0, extra: 1 },
    { kind: "text", path: new Array(129).fill(0), text: "A😀B", offset: 0 },
    { kind: "element", path: [0], tag: "p", offset: 1 },
    { kind: "element", path: [0, 0], tag: "p", offset: 0 },
    { kind: "other", path: [0], tag: "p", offset: 0 },
  ])("拒绝伪造或越界point %#", point => {
    expect(indexMobiSourceHtml("<p>A😀B</p>").matches(point)).toBe(false);
  });
  it("可匹配text末尾和代理对两侧，但不能匹配注释节点", () => {
    const index = indexMobiSourceHtml("<p>A😀B</p><!--A😀B-->");
    for (const offset of [0, 1, 3, 4]) expect(index.matches(textPoint([0, 0], "A😀B", offset))).toBe(true);
    expect(index.matches(textPoint([1], "A😀B", 0))).toBe(false);
  });
  it.each([-1, NaN, Infinity, 1.5, "3", null, undefined])("sourceOffset必须为有效UTF16整数：%s", value => {
    expect(indexMobiSourceHtml("<p>字</p>").locate(value as number)).toBeNull();
  });
});

describe("body结构签名", () => {
  it("SHA256包含资源和ID身份，资源改写必须先提供受控投影", () => {
    const a = indexMobiSourceHtml('<body><p id="a">正文&amp;😀</p><img src="kindle:embed:1"></body>');
    const b = indexMobiSourceHtml('<body class="x"><p title="x" id="b">正文&#38;😀</p><img alt="x" src="mobi-resource-v1/1.png"></body>');
    expect(a.structureHash).toMatch(/^[a-f0-9]{64}$/u); expect(a.structureHash).not.toBe(b.structureHash);
    expect(a.structureHash).toBe(indexMobiSourceHtml('<body><p id="a">正文&amp;😀</p><img src="kindle:embed:1"></body>').structureHash);
  });
  it("element局部匹配不足以证明来源，正文变化/同标签重排必须由structure挡住", () => {
    const a = indexMobiSourceHtml('<p>第一段</p><p>第二段</p>'), point = a.locate(0);
    for (const html of ['<p>第二段</p><p>第一段</p>', '<p>别的段落</p><p>第二段</p>']) {
      const changed = indexMobiSourceHtml(html);
      expect(changed.matches(point)).toBe(true); expect(changed.structureHash).not.toBe(a.structureHash);
    }
  });
  it("子节点顺序/文本空白/注释槽位/嵌套/namespace均进入签名", () => {
    const original = indexMobiSourceHtml('<p>A<b>B</b></p>');
    for (const html of ['<p> A<b>B</b></p>', '<p>A<!--slot--><b>B</b></p>', '<p>AB<b></b></p>', '<p>A</p><b>B</b>', '<p>A<i>B</i></p>']) {
      expect(indexMobiSourceHtml(html).structureHash).not.toBe(original.structureHash);
    }
    expect(indexMobiSourceHtml('<svg><text>x</text></svg>').structureHash).not.toBe(indexMobiSourceHtml('<math><mi>x</mi></math>').structureHash);
    expect(indexMobiSourceHtml('<p>A\r\nB</p>').structureHash).toBe(indexMobiSourceHtml('<p>A\nB</p>').structureHash);
  });
  it("非正文opaque占位不暴露内部，移走占位或转可见都会改变签名", () => {
    for (const tag of ["script", "style", "template", "noscript"]) {
      const a = indexMobiSourceHtml(`<body><${tag}>原内部</${tag}><p>正文</p></body>`);
      const b = indexMobiSourceHtml(`<body><${tag}>改写内部</${tag}><p>正文</p></body>`);
      expect(a.structureHash).toBe(b.structureHash); expect(a.structureHash).not.toBe(indexMobiSourceHtml('<p>正文</p>').structureHash);
    }
    expect(indexMobiSourceHtml('<p hidden>正文</p>').structureHash).not.toBe(indexMobiSourceHtml('<p>正文</p>').structureHash);
  });
});

describe("预算与无副作用", () => {
  it("HTML输入类型/20M UTF16上限在解析前检查", () => {
    for (const value of [null, 1, {}, undefined]) expect(() => indexMobiSourceHtml(value as string)).toThrow(/类型/u);
    expect(() => indexMobiSourceHtml("x".repeat(20_000_001))).toThrow(/长度/u);
    expect(indexMobiSourceHtml("").locate(0)).toBeNull();
  });
  it("全树depth包含隐式根节点，128可接受129拒绝，隐藏区不豁免", () => {
    const html = '<div>'.repeat(125) + 'x' + '</div>'.repeat(125);
    const index = indexMobiSourceHtml(html); expect(index.locate(html.indexOf('x'))?.path).toHaveLength(126);
    expect(() => indexMobiSourceHtml('<div>'.repeat(126) + 'x' + '</div>'.repeat(126))).toThrow(/深度/u);
    expect(() => indexMobiSourceHtml('<div hidden>' + html + '</div>')).toThrow(/深度/u);
  });
  it("400k节点预算包含注释和隐式节点", () => {
    expect(() => indexMobiSourceHtml('<!--x-->'.repeat(400_001))).toThrow(/节点/u);
  }, 20_000);
  it("不执行脚本或请求网络，head文字不进body签名", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const html = '<head><title>元数据</title><link href="https://example.invalid"></head><body><script>globalThis.MOBI_SOURCE_EXECUTED=true;fetch("https://example.invalid")</script><p>正文</p></body>';
      const index = indexMobiSourceHtml(html);
      expect(index.locate(html.indexOf("正文"))).toEqual(textPoint([1, 0], "正文", 0));
      expect(index.structureHash).toBe(indexMobiSourceHtml(html.replace('元数据', '另一标题')).structureHash);
      expect(fetch).not.toHaveBeenCalled(); expect(Reflect.get(globalThis, "MOBI_SOURCE_EXECUTED")).toBeUndefined();
    } finally { fetch.mockRestore(); }
  });
});

describe("正文fragment解析上下文",()=>{
 it("首尾空白和注释保留在body childNodes，不受完整document插入模式吞掉",()=>{
  const html='\n  <!--注--><p>甲😀 &amp; 乙</p>\n';const index=indexMobiSourceHtml(html,'body-fragment');
  expect(index.locate(0)).toEqual(textPoint([0],'\n  ',0));
  expect(index.locate(html.indexOf('<p>'))).toEqual({kind:'element',path:[2],tag:'p',offset:0});
  const point=index.locate(html.indexOf('乙'));expect(point).toEqual(textPoint([2,0],'甲😀 & 乙',6));expect(index.matches(point)).toBe(true);
  expect(index.locate(html.length-1)).toEqual(textPoint([3],'\n',0));
 });
 it("节点路径服从真实body fragment的table修复，不接受被隐式创建的元素作为原始落点",()=>{
  const html='\n<table><tr><td>正文</td></tr></table>',index=indexMobiSourceHtml(html,'body-fragment');
  const point=index.locate(html.indexOf('正文'));expect(point).toEqual(textPoint([1,0,0,0,0],'正文',0));expect(index.matches(point)).toBe(true);
  expect(index.locate(html.indexOf('<tr>'))).toEqual({kind:'element',path:[1,0,0],tag:'tr',offset:0});
  expect(index.matches({kind:'element',path:[1,0],tag:'tbody',offset:0})).toBe(false);
 });
 it("两种解析上下文不是可混用签名；无效上下文明确失败",()=>{
  const html='\n<p>x</p>';expect(indexMobiSourceHtml(html).structureHash).not.toBe(indexMobiSourceHtml(html,'body-fragment').structureHash);
  expect(()=>indexMobiSourceHtml(html,'invalid' as 'document')).toThrow('上下文');
 });
});
