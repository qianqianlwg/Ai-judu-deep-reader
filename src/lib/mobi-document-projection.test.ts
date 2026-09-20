import { describe, expect, it, vi } from "vitest";
import { defaultTreeAdapter, html as syntax, parse, parseFragment } from "parse5";
import { projectMobiDocument } from "./mobi-document-projection.mjs";
function project(source: string) {
  const result = projectMobiDocument(source);
  expect(result.body).toBe(source.slice(result.start, result.end));
  expect(result.start).toBeGreaterThanOrEqual(0); expect(result.end).toBeLessThanOrEqual(source.length);
  expect(result.prefixEnd).toBeLessThanOrEqual(result.start);
  return result;
}

describe("完整文档和不trim的真实源码窗口", () => {
  it("KF8完整文档精确返回body/head及原始UTF16偏移，排除容器外空白和注释", () => {
    const head = '\r\n<title>自造😀&amp;标题</title><style>p{color:red}</style>\n';
    const body = '\r\n  <p>中文😀 &amp; 保留</p>\r\n\t';
    const opening = '<BoDy data-note="a > b" class=book>', prefix = `<!--前😀--><!doctype html>\n<html>\n<head>${head}</head>\n`;
    const source = prefix + opening + body + '</BODY> \r\n<!--间隔--></html>\n<!--后-->';
    expect(project(source)).toEqual({ bodyAllowed:true, body, head, prefixEnd: prefix.length, start: prefix.length + opening.length, end: prefix.length + opening.length + body.length });
  });
  it("不会把body外合并进DOM文本的尾空白附加到body源码", () => {
    const source = '<html><head></head><body>  内部 \n</body>\r\n</html>\t';
    const document = parse(source, { sourceCodeLocationInfo: true });
    const root = document.childNodes.find(node => 'tagName' in node && node.tagName === 'html');
    const body = root && 'childNodes' in root ? root.childNodes.find(node => 'tagName' in node && node.tagName === 'body') : undefined;
    const text = body && 'childNodes' in body ? body.childNodes.find(node => 'value' in node) : undefined;
    expect(text && 'value' in text ? text.value : '').toBe('  内部 \n\n\t');
    expect(project(source).body).toBe('  内部 \n');
  });
  it("属性中含>及伪body标签不能截短真实开标签", () => {
    const opening = '<body title="假 > <body> </body>" data-x=1>';
    const source = '<html>' + opening + '真实</body></html>';
    expect(project(source)).toMatchObject({ start: 6 + opening.length, prefixEnd: 6, body: '真实' });
  });
  it("MOBI第一章只有开body且未闭合的正文原样保留至EOF", () => {
    const source = '<html><head><title>书名</title></head><body class="x">\r\n<p>本章未完😀';
    const result = project(source);
    expect(result.body).toBe('\r\n<p>本章未完😀'); expect(result.head).toBe('<title>书名</title>'); expect(result.end).toBe(source.length);
  });
  it.each(['', ' ', '\r\n\t', '<p>正文</p>', '\n<style>p{color:red}</style>\n<title>不是head裁切依据</title><p>正文</p>  ', '<!--<body>假</body>-->\n<p>真</p>\n'])('中间纯fragment完整保留：%j', source => {
    expect(project(source)).toEqual({ bodyAllowed:true, body: source, head: '', start: 0, end: source.length, prefixEnd: 0 });
  });
  it("body上下文fragment解析保留首部空白/style/title，不引入隐式head裁切", () => {
    const source = '\r\n  <style>p{color:red}</style><title>标题</title><p>正文</p> \n';
    const result = project(source), context = defaultTreeAdapter.createElement('body', syntax.NS.HTML, []);
    const fragment = parseFragment(context, result.body, { sourceCodeLocationInfo: true });
    expect(fragment.childNodes.map(node => node.nodeName)).toEqual(['#text', 'style', 'title', 'p', '#text']);
    expect(fragment.childNodes[0]).toMatchObject({ value: '\n  ', sourceCodeLocation: { startOffset: 0 } });
  });
  it.each(['\n<p>末章</p>  </body></html>\r\n<!--尾-->', '  末章</div></body></html> ', '  </body></html>  ', '<p>末章</p> </html>  '])('末章只闭body/html，使用被接受的隐式body关闭：%j', source => {
    const result = project(source), closing = source.includes('</body>') ? source.indexOf('</body>') : source.indexOf('</html>');
    expect(result).toMatchObject({ body: source.slice(0, closing), start: 0, end: closing, head: '', prefixEnd: 0 });
    const root = parse(source, { sourceCodeLocationInfo: true }).childNodes.find(node => 'tagName' in node && node.tagName === 'html');
    const body = root && 'childNodes' in root ? root.childNodes.find(node => 'tagName' in node && node.tagName === 'body') : undefined;
    expect(body?.sourceCodeLocation).toBeNull();
  });
  it("明确head无body时从真实head结束保留后续空白", () => {
    const prefix = '<head data-x=1>\n<title>头</title>\n</head>', tail = '\r\n<p>正文</p>  ';
    expect(project(prefix + tail)).toEqual({ bodyAllowed:true, head: '\n<title>头</title>\n', body: tail, start: prefix.length, end: prefix.length + tail.length, prefixEnd: prefix.length });
  });
  it("head省略关闭标签时以解析器实际弹出边界投影，不吞后续正文", () => {
    const prefix = '<head><title>头</title>';
    expect(project(prefix + '<p>正文</p>')).toMatchObject({ head: '<title>头</title>', body: '<p>正文</p>', start: prefix.length });
    expect(project('<head>直接正文</head><p>后续</p>')).toMatchObject({ head: '', body: '直接正文</head><p>后续</p>', start: 6 });
  });
  it("显式文档的隐式head真实内容可提取，纯片段相同style不能被提取", () => {
    const head = '<style>p{color:red}</style>\n<title>头</title>\n';
    expect(project('<html>' + head + '<p>正文</p></html>')).toMatchObject({ head, body: '<p>正文</p>' });
    expect(project(head + '<p>正文</p>')).toMatchObject({ head: '', body: head + '<p>正文</p>', start: 0 });
  });
  it("无头部内容的空body及纯doctype文档不虚构正文", () => {
    expect(project('<body></body>')).toEqual({ bodyAllowed:true, body: '', head: '', start: 6, end: 6, prefixEnd: 0 });
    expect(project('<!doctype html>')).toMatchObject({ body: '', head: '', start: 15, end: 15 });
  });
});

describe("伪标签、被忽略关闭与歧义拒绝", () => {
  it("head中的script/style/template/注释伪body不能影响真实边界", () => {
    const head = '<script>const s="<body>假</body></html>";</script><style>x{content:"<body>假</body>"}</style><template><body>模板</body></template><!--<body>注释</body>-->';
    const source = '<html><head>' + head + '</head><body>\n真正文\n</body></html>';
    expect(project(source)).toMatchObject({ head, body: '\n真正文\n', start: source.indexOf('<body>\n') + 6 });
  });
  it.each([
    '<script>const s="</body></html>";</script>尾', '<style>x{content:"</body></html>"}</style>尾',
    '<template></body><p>模板</p></template>尾', '<p title="</body></html>">正文</p>',
    '<!--</body></html>--><p>正文</p>', '<textarea></body></html></textarea>尾',
    '<table>正文</body><tr><td>单元</td></tr></table>尾', '<select><option>选项</body></select>尾',
  ])('未被解析器接受的伪关闭不能按字面截断：%s', source => {
    expect(project(source)).toMatchObject({ body: source, start: 0, end: source.length, head: '' });
  });
  it("被忽略的table内闭body之后，真正闭body仍可定位", () => {
    const content = '<table>正文</body><tr><td>单元</td></tr></table>尾';
    const source = '<body>' + content + '</body></html>';
    expect(project(source)).toMatchObject({ body: content, start: 6, end: 6 + content.length });
  });
  it.each(['外部正文', '<p>外段</p>', '<img src="x.png">', '<script>literal</script>', '<style>p{}</style>', '\u00a0', '\0', '&#65;', '</div>', '</body>', '</html></html>'])('body外实质内容或未接受标签必须拒绝：%j', tail => {
    expect(() => projectMobiDocument('<html><body>正文</body>' + tail + '</html>')).toThrow(/容器外/u);
  });
  it("前置正文不会因后面的body标记被静默裁去", () => {
    const source = '<html><head><title>头</title></head>前置正文<body>内部正文</body></html>';
    expect(project(source).body).toBe('前置正文<body>内部正文');
  });
  it.each(['<frameset><frame src="x"></frameset>', '<html><frameset></frameset></html>'])('明确拒绝不支持的frameset：%s', source => {
    expect(() => projectMobiDocument(source)).toThrow(/frameset/u);
  });
  it("head结束后又被解析器挪进head的元素不能静默遗漏", () => {
    expect(() => projectMobiDocument('<html><head></head><title>迟到标题</title><body>正文</body></html>')).toThrow(/head|容器外/u);
  });
  it("串联两个完整文档必须失败，不能只取第一本正文", () => {
    expect(() => projectMobiDocument('<html><body>A</body></html><html><body>B</body></html>')).toThrow(/容器外/u);
  });
});

describe("预算和纯解析", () => {
  it.each([null, undefined, 1, {}, [], 'x'.repeat(20_000_001)])('非法或超20M输入在解析前拒绝 %#', value => {
    expect(() => projectMobiDocument(value as string)).toThrow(/类型|20M/u);
  });
  it("400k节点包括注释；depth128包括隐式容器和template内容", () => {
    expect(() => projectMobiDocument('<!--x-->'.repeat(400_001))).toThrow(/节点/u);
    const deepest = '<div>'.repeat(125) + 'x' + '</div>'.repeat(125);
    expect(project(deepest).body).toBe(deepest);
    expect(() => projectMobiDocument('<div>' + deepest + '</div>')).toThrow(/深度/u);
    expect(() => projectMobiDocument('<template>' + deepest + '</template>')).toThrow(/深度/u);
  }, 20_000);
  it("重复忽略标签也有token预算，不能以少量DOM节点绕过", () => {
    expect(() => projectMobiDocument('<body>'.repeat(800_001))).toThrow(/token/u);
  }, 20_000);
  it("不解实体、不改CRLF、不执行脚本或下载外链", () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    try {
      const content = '\r\n<script>globalThis.MOBI_PROJECTION_EXECUTED=true;fetch("https://example.invalid")</script><img src="https://example.invalid/x"><p>&amp;😀</p>\r\n';
      expect(project('<body>' + content + '</body>').body).toBe(content);
      expect(fetch).not.toHaveBeenCalled(); expect(Reflect.get(globalThis, 'MOBI_PROJECTION_EXECUTED')).toBeUndefined();
    } finally { fetch.mockRestore(); }
  });
});
it.each(['<html hidden><body>','<body hidden>','<body style="display:none">','<body aria-hidden="true">'])('裁去容器仍保留原始祖先排除语义 %s',opening=>{const p=projectMobiDocument(opening+'<p>secret</p></body>');expect(p.body).toBe('<p>secret</p>');expect(p.bodyAllowed).toBe(false);});
