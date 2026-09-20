// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFb2Xml, parseFb2Xml, fb2Elements, fb2Text, fb2NormalizedText, FB2_NAMESPACE, FB2_XML_LIMIT } from "./fb2-xml";
const xml = (body = "<body><section><p>正文</p></section></body>") => `<FictionBook xmlns="${FB2_NAMESPACE}">${body}</FictionBook>`;
const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
function utf16(text: string, endian: "le" | "be", bom = true): Uint8Array {
  const encoded = Buffer.from(text, "utf16le"); if (endian === "be") encoded.swap16();
  return new Uint8Array(bom ? Buffer.concat([Buffer.from(endian === "le" ? [255, 254] : [254, 255]), encoded]) : encoded);
}
function paragraph(text: string) { return xml(`<body><section><p>${text}</p></section></body>`); }
function bodyText(bytes: Uint8Array): string { return fb2Text(fb2Elements(parseFb2Xml(bytes), "body")[0]); }
afterEach(() => vi.restoreAllMocks());
// WHY：编码fixture由独立字节编码器构造，不用被测decoder生成期望值，不读取真实书籍。
describe("FB2 XML字节编码", () => {
  it.each([false, true])("UTF8 BOM=%s保留中文、公式、emoji及正文前导零", bom => {
    const text = '<?xml version="1.0" encoding="UTF-8"?>' + paragraph("00012 甲 &lt;x&gt; 😀");
    const bytes = bom ? new Uint8Array(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)])) : utf8(text);
    expect(decodeFb2Xml(bytes)).toBe(text); expect(bodyText(bytes)).toBe("00012 甲 <x> 😀");
  });
  it.each(["le", "be"] as const)("UTF16%s带BOM遵守UTF-16通用声明且保留增补字符", endian => {
    const text = '<?xml version="1.0" encoding="UTF-16"?>' + paragraph("甲😀𠀀 &amp;乙");
    expect(decodeFb2Xml(utf16(text, endian))).toBe(text); expect(bodyText(utf16(text, endian))).toBe("甲😀𠀀 &乙");
  });
  it.each(["le", "be"] as const)("UTF16%s无BOM用字节序和明确声明识别", endian => {
    const text = `<?xml version="1.0" encoding="UTF-16${endian.toUpperCase()}"?>` + paragraph("甲😀");
    expect(bodyText(utf16(text, endian, false))).toBe("甲😀");
  });
  it("windows-1251声明按真实俄文单字节解码，不出现替代字符", () => {
    const prefix = `<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="${FB2_NAMESPACE}"><body><section><p>`;
    const bytes = Buffer.concat([Buffer.from(prefix, "ascii"), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xa8, 0xe6]), Buffer.from("</p></section></body></FictionBook>")]);
    expect(bodyText(bytes)).toBe("Привет Ёж"); expect(decodeFb2Xml(bytes)).not.toContain("�");
  });
  it.each([
    { endian: "le" as const, declaration: "UTF-8" }, { endian: "be" as const, declaration: "UTF-16LE" },
  ])("BOM $endian 与声明 $declaration 冲突明确拒绝", ({ endian, declaration }) => {
    expect(() => decodeFb2Xml(utf16(`<?xml version="1.0" encoding="${declaration}"?>` + xml(), endian))).toThrow(/编码.*冲突/);
  });
  it("UTF8 BOM与windows1251声明冲突拒绝", () => {
    const bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('<?xml version="1.0" encoding="windows-1251"?>' + xml())]);
    expect(() => decodeFb2Xml(bytes)).toThrow(/冲突/);
  });
  it("未知编码不自动回退UTF8", () => {
    expect(() => decodeFb2Xml(utf8('<?xml version="1.0" encoding="made-up"?>' + xml()))).toThrow(/编码.*不支持/);
  });
  it.each([[0xc3, 0x28], [0xed, 0xa0, 0x80], [0xf0, 0x9f]])("损坏UTF8字节%j必须拒绝而非产生替代字符", (...values) => {
    expect(() => decodeFb2Xml(new Uint8Array(values))).toThrow();
  });
  it("奇数字节或孤立代理项UTF16不能静默恢复", () => {
    expect(() => decodeFb2Xml(new Uint8Array([255, 254, 60]))).toThrow();
    expect(() => decodeFb2Xml(new Uint8Array([255, 254, 0, 216]))).toThrow();
  });
  it("零字节和超过24MiB输入在解析前拒绝", () => {
    expect(() => decodeFb2Xml(new Uint8Array())).toThrow(/1字节至24MiB/);
    expect(() => decodeFb2Xml(new Uint8Array(FB2_XML_LIMIT + 1))).toThrow(/1字节至24MiB/);
  });
  it("Node Buffer与浏览器Uint8Array对同字节产生相同模型且不修改输入", () => {
    const bytes = Buffer.from(paragraph("甲&amp;😀")), browserBytes = new window.Uint8Array(bytes), before = [...bytes];
    expect(parseFb2Xml(bytes)).toEqual(parseFb2Xml(browserBytes)); expect([...bytes]).toEqual(before); expect([...browserBytes]).toEqual(before);
  });
});

describe("FB2 XML命名空间与文本保真", () => {
  it("合法带xmlns前缀的整本FB2与默认命名空间具有同样局部名/正文", () => {
    const bytes = utf8(`<f:FictionBook xmlns:f="${FB2_NAMESPACE}" xmlns:l="http://www.w3.org/1999/xlink"><f:body><f:section><f:p xml:lang="zh">甲<f:a l:href="#note">引用</f:a></f:p></f:section></f:body></f:FictionBook>`);
    const root = parseFb2Xml(bytes), p = fb2Elements(fb2Elements(fb2Elements(root, "body")[0], "section")[0], "p")[0], link = fb2Elements(p, "a")[0];
    expect(root.name).toBe("FictionBook"); expect(root.namespace).toBe(FB2_NAMESPACE); expect(fb2Text(p)).toBe("甲引用");
    expect(p.attributeNamespaces["xml:lang"]).toBe("http://www.w3.org/XML/1998/namespace"); expect(link.attributeNamespaces["l:href"]).toBe("http://www.w3.org/1999/xlink");
  });
  it("子层前缀重绑定只作用于该层，不污染后续兄弟", () => {
    const root = parseFb2Xml(utf8(`<f:FictionBook xmlns:f="${FB2_NAMESPACE}"><f:body><f:section><f:p xmlns:f="urn:foreign">外部</f:p><f:p>正文</f:p></f:section></f:body></f:FictionBook>`));
    const children = fb2Elements(fb2Elements(fb2Elements(root, "body")[0], "section")[0]);
    expect(children.map(c => c.namespace)).toEqual(["urn:foreign", FB2_NAMESPACE]);
  });
  it.each(["missing", "toString", "constructor", "__proto__"])("未声明前缀%s即使同名Object属性也必须拒绝", prefix => {
    expect(() => parseFb2Xml(utf8(xml(`<body><section><${prefix}:p>甲</${prefix}:p></section></body>`)))).toThrow(/命名空间/);
  });
  it("未声明属性前缀拒绝，普通未限定属性不继承默认命名空间", () => {
    expect(() => parseFb2Xml(utf8(xml('<body bad:key="1"/>')))).toThrow(/命名空间/);
    expect(fb2Elements(parseFb2Xml(utf8(xml('<body id="b"/>'))), "body")[0].attributeNamespaces.id).toBe("");
  });
  it.each(["<Wrong/>", '<FictionBook xmlns="urn:wrong"/>', "<FictionBook/><FictionBook/>", "outside<FictionBook/>", "<FictionBook><body></FictionBook>"])("错误根或结构 %s 明确失败", content => {
    expect(() => parseFb2Xml(utf8(content))).toThrow();
  });
  it("正常XML实体仅解码一次，真实符号和emoji精确保留", () => {
    expect(bodyText(utf8(paragraph('&lt;&gt;&amp;&quot;&apos; &#65;&#x1F600; &amp;lt;')))).toBe('<>&"\' A😀 &lt;');
  });
  it("前缀文字+CDATA+后缀与内联节点保持完整顺序，不吞CDATA或二次解码", () => {
    const content = 'prefix<![CDATA[<x>&amp; 😀]]><emphasis>中间</emphasis><![CDATA[<&>]]>suffix';
    expect(bodyText(utf8(paragraph(content)))).toBe("prefix<x>&amp; 😀中间<&>suffix");
  });
  it("CDATA和注释中的DOCTYPE/ENTITY仅为文字或注释，不错误拒绝", () => {
    const content = '<!-- <!DOCTYPE x [<!ENTITY e SYSTEM "https://example.invalid">]> -->' + paragraph('<![CDATA[<!DOCTYPE x>&unknown;]]>正文');
    expect(bodyText(utf8(content))).toBe("<!DOCTYPE x>&unknown;正文");
  });
  it("fb2Text原样保留空白，normalized仅折叠空白不改符号", () => {
    const root = parseFb2Xml(utf8(paragraph(" 甲\t乙\n&lt;😀&gt;  ")));
    expect(fb2Text(root)).toBe(" 甲\t乙\n<😀>  "); expect(fb2NormalizedText(root)).toBe("甲 乙 <😀>");
  });
});

describe("FB2 XML主动内容和资源边界", () => {
  it.each([
    '<!DOCTYPE FictionBook SYSTEM "file:///private/secret">',
    '<!DOCTYPE FictionBook [<!ENTITY x SYSTEM "https://example.invalid/secret">]>',
    '<!DOCTYPE FictionBook [<!ENTITY a "expanded"><!ENTITY b "&a;&a;">]>',
  ])("DTD或实体定义不可触发IO：%s", declaration => {
    const request = vi.spyOn(globalThis, "fetch");
    expect(() => parseFb2Xml(utf8(declaration + paragraph("&x;")))).toThrow(/DTD|实体/); expect(request).not.toHaveBeenCalled();
  });
  it.each(["&undefined;", "&amp", "&broken", "&#xZZ;", "&#;"])("损坏或未定义实体%s拒绝", entity => {
    expect(() => parseFb2Xml(utf8(paragraph(entity)))).toThrow();
  });
  it.each(["\0", "\u0001", "\u0008", "\u000b", "\u000c", "\u001f"])("正文原始控制字符%j拒绝", character => {
    expect(() => parseFb2Xml(utf8(paragraph("前" + character + "后")))).toThrow(/无效XML字符/);
  });
  it.each(["&#0;", "&#x1F;", "&#xD800;", "&#xDFFF;", "&#xFFFE;", "&#xFFFF;", "&#x110000;"])("字符引用%s解码后仍必须满足XML有效字符范围", entity => {
    expect(() => parseFb2Xml(utf8(paragraph(entity)))).toThrow();
  });
  it("属性中的字符引用NUL同样拒绝", () => {
    expect(() => parseFb2Xml(utf8(xml('<body id="a&#0;b"><section><p>正文</p></section></body>')))).toThrow();
  });
  it("深度未超限可解析，超过128层明确拒绝而不是忽略深层文字", () => {
    expect(bodyText(utf8(xml("<section>".repeat(100) + "甲" + "</section>".repeat(100)).replace("<section>", "<body><section>").replace("</FictionBook>", "</body></FictionBook>")))).toBe("甲");
    expect(() => parseFb2Xml(utf8(xml("<section>".repeat(130) + "甲" + "</section>".repeat(130))))).toThrow(/层级.*超限/);
  });
  it("超过20万节点明确失败，不返回裁剪过的树", () => {
    expect(() => parseFb2Xml(utf8(xml("<body>" + "<p/>".repeat(200001) + "</body>")))).toThrow(/节点数量超限/);
  }, 15000);
});

describe("FB2命名空间与实体修复的对照样本", () => {
  it.each(["toString", "constructor", "__proto__"])("显式声明的合法前缀%s应可用，不能用黑名单代替命名空间归属", prefix => {
    const source = `<${prefix}:FictionBook xmlns:${prefix}="${FB2_NAMESPACE}"><${prefix}:body><${prefix}:section><${prefix}:p>正文</${prefix}:p></${prefix}:section></${prefix}:body></${prefix}:FictionBook>`;
    const root = parseFb2Xml(utf8(source)); expect(root.namespace).toBe(FB2_NAMESPACE); expect(fb2Text(root)).toBe("正文");
  });
  it("正文和属性数字引用都应解码一次，CDATA内相同串不得解码", () => {
    const root = parseFb2Xml(utf8(xml('<body><section id="a&#x1F600;"><p>&#x4E2D;<![CDATA[&#x4E2D;]]>&amp;#x4E2D;</p></section></body>')));
    const section = fb2Elements(fb2Elements(root, "body")[0], "section")[0];
    expect(section.attributes.id).toBe("a😀"); expect(fb2Text(section)).toBe("中&#x4E2D;&#x4E2D;");
  });
  it.each(["\ufffe", "\uffff"])("非法XML标量%j以原始UTF8字节进入也拒绝", value => {
    expect(() => parseFb2Xml(utf8(paragraph(value)))).toThrow();
  });
});
