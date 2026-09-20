import { describe, expect, it, vi } from 'vitest';
import { sanitizeMobiDocument, MOBI_DOCUMENT_SANITIZER_LIMITS } from './mobi-document-sanitizer.mjs';

const token = (name: string) => `mobi-resource-v1/${name}`;

function resolverFor(values: Record<string, string> = {}) {
  return vi.fn(async (value: string, role: string) => values[`${role}:${value}`] ?? null);
}

function sanitizerOptions(
  resolve: (value: string, role: string) => Promise<string | null>,
  validate: (token:string, role:string)=>boolean|Promise<boolean> = async () => true,
) {
  return { resolve, validate };
}

describe('MOBI 独立章节净化器', () => {
  it('删除脚本、危险元素、事件属性和未知属性/命名空间，同时保留文本与 head', async () => {
    const resolve = resolverFor();
    const result = await sanitizeMobiDocument(`<html><head><title>题名</title><script>alert(1)</script></head><body>
      <p id="p">正文 <span onclick="evil()" data-no="x">内容</span></p>
      <script>evil()</script><iframe src="x"></iframe><object data="x"></object><embed src="x"><form action="x"><input name="x"></form>
      <p bad:attr="x" xmlns:bad="https://evil.test">尾部</p>
    </body></html>`, {...sanitizerOptions(resolve), mode:'document'});

    expect(result.html).toContain('正文');
    expect(result.html).toContain('id="p"');
    expect(result.html).not.toMatch(/script|iframe|object|embed|form|onclick|data-no|evil\.test/iu);
    expect(result.head).toBe('<title>题名</title>');
    expect(result.diagnostics.some((item) => item.reason === 'dangerous-element')).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('按元素和角色调用 resolver，只输出已验证的 MOBI token 或安全锚点', async () => {
    const resolve = resolverFor({
      [`image:images/p.png`]: token('p.png'),
      [`style:styles/book.css`]: token('book.css'),
      [`media:audio/book.mp3`]: token('book.mp3'),
      [`navigation:chapter-2.xhtml`]: token('chapter-2.xhtml'),
      [`image:#shape`]: '#shape',
    });
    const result = await sanitizeMobiDocument(`<p><img src="images/p.png"><a href="chapter-2.xhtml">下一章</a>
      <a href="#note">脚注</a><a href="https://evil.test/out">外链</a>
      <link rel="stylesheet" href="styles/book.css"><audio src="audio/book.mp3"></audio>
      <svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/></svg></p>`, sanitizerOptions(resolve));

    expect(result.html).toContain(`src="${token('p.png')}"`);
    expect(result.html).toContain(`href="${token('chapter-2.xhtml')}"`);
    expect(result.html).toContain('href="#note"');
    expect(result.html).toContain(`href="${token('book.css')}"`);
    expect(result.html).toContain(`src="${token('book.mp3')}"`);
    expect(result.html).toContain('href="#shape"');
    expect(result.html).not.toContain('evil.test');
    expect(resolve).toHaveBeenCalledWith('images/p.png', 'image');
    expect(resolve).toHaveBeenCalledWith('styles/book.css', 'style');
    expect(resolve).toHaveBeenCalledWith('audio/book.mp3', 'media');
    expect(resolve).toHaveBeenCalledWith('chapter-2.xhtml', 'navigation');
    expect(resolve).toHaveBeenCalledWith('#shape', 'image');
  });

  it('使用固定 CSS AST sanitizer 处理 style 属性、style 元素和 SVG URL presentation 属性', async () => {
    const resolve = resolverFor({ [`css:images/p.png`]: token('p.png') });
    const result = await sanitizeMobiDocument(`<style>
      @import url(https://evil.test/book.css);
      p { color: red; background: url(images/p.png); }
      p { background-image: image-set(url(https://evil.test/x) 1x); }
    </style><p style="background:url(images/p.png);width:calc(10px + 2px);color:var(--evil)">正文</p>
      <svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.test/x)" stroke="red"/></svg>`, sanitizerOptions(resolve));

    expect(result.html).toContain(`url(${token('p.png')})`);
    expect(result.html).toContain('color:red');
    expect(result.html).toContain('width:calc(10px + 2px)');
    expect(result.diagnostics).toContainEqual({ kind: 'attribute', action: 'rewritten', name: 'stroke', reason: 'presentation-to-style' });
    expect(result.html).not.toMatch(/evil\.test|image-set|var\(--evil\)|@import/iu);
    expect(result.html).not.toMatch(/fill="/u);
    expect(resolve).toHaveBeenCalledWith('images/p.png', 'css');
  });

  it('按 HTML/SVG/MathML 白名单保留公式和图形，删除未知命名空间与标签', async () => {
    const result = await sanitizeMobiDocument(`<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mn>2</mn></mfrac><annotation-xml><script/></annotation-xml></math>
      <svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/><foreignObject><p>bad</p></foreignObject></svg>
      <custom-widget>bad</custom-widget>`, sanitizerOptions(resolverFor()));

    expect(result.html).toContain('<math');
    expect(result.html).toContain('<mfrac>');
    expect(result.html).toContain('<path');
    expect(result.html).not.toMatch(/annotation-xml|foreignObject|custom-widget|bad/iu);
  });

  it('删除危险元素时仍统计被丢弃子树，不能绕过节点预算', async () => {
    const nested = '<p>x</p>'.repeat(50_000);
    await expect(sanitizeMobiDocument(`<form>${nested}</form>`, sanitizerOptions(resolverFor())))
      .rejects.toThrow('节点预算超限');
  });

  it('拒绝超大输入，resolver 失败上抛，异步 resolver 能被等待', async () => {
    await expect(sanitizeMobiDocument('x'.repeat(MOBI_DOCUMENT_SANITIZER_LIMITS.inputCharacters + 1), sanitizerOptions(resolverFor())))
      .rejects.toThrow('输入字符超限');
    const resolve = vi.fn(async () => { throw new Error('resolver failure'); });
    await expect(sanitizeMobiDocument('<img src="images/p.png">', sanitizerOptions(resolve))).rejects.toThrow('resolver failure');
    expect(resolve).toHaveBeenCalledWith('images/p.png', 'image');
  });

  it('不把 resolver 返回的外链或非法 token 交给浏览器，并记录诊断', async () => {
    const resolve = vi.fn(async () => 'https://evil.test/asset.png');
    const result = await sanitizeMobiDocument('<img src="images/p.png"><a href="javascript:alert(1)">坏链接</a>', sanitizerOptions(resolve));
    expect(result.html).not.toMatch(/src=|href=|evil\.test|javascript:/iu);
    expect(result.diagnostics.filter((item) => item.kind === 'resource')).toHaveLength(2);
  });
});
// 回归固化独立验收探针：返回值必须真正通过角色门禁，不依赖类型断言。
it.each(['image','style','media','css','navigation'])('资源角色%s验证不通过时不能输出token', async role=>{
 const source=role==='image'?'<img src="a">':role==='style'?'<link rel="stylesheet" href="a">':role==='media'?'<video src="a"></video>':role==='css'?'<p style="background:url(a)">x</p>':'<a href="a">x</a>';
 const validate=vi.fn(async()=>false), resolve=vi.fn(async()=>token('wrong.js'));
 const result=await sanitizeMobiDocument(source,sanitizerOptions(resolve,validate));
 expect(validate).toHaveBeenCalledWith(token('wrong.js'),role);expect(result.html).not.toContain('wrong.js');
});
it('validator异常和非boolean返回必须显式失败',async()=>{
 const resolve=vi.fn(async()=>token('p.png'));
 await expect(sanitizeMobiDocument('<img src="a">',sanitizerOptions(resolve,async()=>{throw Error('validate failure')}))).rejects.toThrow('validate failure');
 await expect(sanitizeMobiDocument('<img src="a">',sanitizerOptions(resolve,()=> 'yes' as unknown as boolean))).rejects.toThrow('返回类型');
});
it('净化后的来源点随删除节点移动，移除的脚本目标不伪装成正文',async()=>{
 const result=await sanitizeMobiDocument('<script>x</script><p id="same">正文</p>',{
  ...sanitizerOptions(resolverFor()), points:[{kind:'element',path:[0],tag:'script',offset:0},{kind:'element',path:[1],tag:'p',offset:0}],
 });
 expect(result.points).toEqual([null,{kind:'element',path:[0],tag:'p',offset:0}]);
});
it('保留隐藏属性，presentation样式不能覆盖内联样式',async()=>{
 const result=await sanitizeMobiDocument('<p hidden aria-hidden="true" inert>hidden</p><svg><path stroke="red" style="stroke:blue"/></svg>',sanitizerOptions(resolverFor()));
 expect(result.html).toContain('hidden=""');expect(result.html).toContain('aria-hidden="true"');expect(result.html).toContain('inert=""');
 expect(result.html).toContain('style="stroke:red;stroke:blue"');
});
it('源文档声明context而非按注释/属性字符串猜测，body前导空白保留',async()=>{
 const source='  <p title="<html>">文</p>';
 const result=await sanitizeMobiDocument(source,sanitizerOptions(resolverFor()));
 expect(result.html.startsWith('  <p')).toBe(true);expect(result.head).toBe('');
});
it('包内filepos/kindle导航由来源resolver证明后改为安全token',async()=>{
 const resolve=resolverFor({'navigation:filepos:123':token('chapter-1.html')+'#point-1','navigation:kindle:pos:fid:0000:off:000A':token('chapter-1.html')+'#point-2'});
 const result=await sanitizeMobiDocument('<a href="filepos:123">MOBI</a><a href="kindle:pos:fid:0000:off:000A">KF8</a><a href="filepos:wrong">bad</a>',sanitizerOptions(resolve));
 expect(result.html).toContain('#point-1');expect(result.html).toContain('#point-2');expect(result.html).not.toContain('href="filepos:wrong"');
});
