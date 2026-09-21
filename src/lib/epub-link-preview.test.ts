// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { previewEpubLink } from "./epub-link-preview";
const doc = new DOMParser().parseFromString('<p id="note">引用解释</p>', 'text/html');
const createDocument = vi.fn(async () => doc);
const sections = [{ id: 'OPS/ch.xhtml', createDocument, load: async () => null, unload() {} }];
it('读取普通锚点，无需 noteref 标记且不访问网络', async () => {
  expect(await previewEpubLink('#note', sections, 0, doc)).toMatchObject({ text: '引用解释', index: 0, fragment: 'note' });
});
it('跨章节引用从包内文档读取', async () => {
  expect(await previewEpubLink('ch.xhtml#note', [...sections, {...sections[0], id:'OPS/other.xhtml'}], 1, doc)).toMatchObject({index:0,text:'引用解释'});
  expect(createDocument).toHaveBeenCalled();
});
it('外部地址仅显示，不提供内部跳转', async () => {
  for(const href of ['https://example.com/', 'javascript:alert(1)', '//example.com/']) {
    const result=await previewEpubLink(href,sections,0,doc);
    expect(result.index).toBeUndefined();expect(result.address).toBe(href);
  }
});
it('缺失引用明确抛错', async () => {
  await expect(previewEpubLink('#missing',sections,0,doc)).rejects.toThrow('找不到引用目标');
});
it.each([
  ['emoji跨截断边界', '文'.repeat(2399) + '😀后文', '文'.repeat(2399)],
  ['增补汉字跨截断边界', '文'.repeat(2399) + '𠮷后文', '文'.repeat(2399)],
  ['代理对刚好完整落在边界', '文'.repeat(2398) + '😀后文', '文'.repeat(2398) + '😀'],
  ['普通中文仍受长度限制', '文'.repeat(2401), '文'.repeat(2400)],
])('引用概览截断保留完整Unicode字符：%s', async (_label, text, expected) => {
  const document = new DOMParser().parseFromString('<p id="note"></p>', 'text/html');
  document.getElementById('note')!.textContent = text;
  const result = await previewEpubLink('#note', sections, 0, document);
  expect(result.text).toBe(expected);
  expect(result.text.length).toBeLessThanOrEqual(2400);
  expect(/[\uD800-\uDBFF]$/u.test(result.text)).toBe(false);
  expect(result).toMatchObject({ index: 0, fragment: 'note', address: 'OPS/ch.xhtml#note' });
});

it.each([
  ['脚注编号锚点', '<p><a id="note" href="#back">(9)</a> 这是完整脚注解释。</p>', '(9) 这是完整脚注解释。'],
  ['带文字的内联锚点', '<p>前文<span id="note">引用词</span>后文解释。</p>', '前文引用词后文解释。'],
  ['多条脚注只取目标段落', '<section><p>相邻脚注甲</p><p><sup><a id="note">2</a></sup>目标脚注</p><p>相邻脚注乙</p></section>', '2目标脚注'],
  ['脚注语义容器保留多段解释', '<aside epub:type="footnote"><p><a id="note">3</a>解释第一段</p><p>解释第二段</p></aside>', '3解释第一段解释第二段'],
  ['doc-endnote语义容器', '<div role="doc-endnote"><p><span id="note">4</span>解释第一段</p><p>解释第二段</p></div>', '4解释第一段解释第二段'],
  ['原本的段落目标不扩大到章节', '<section><p id="note">指定段落</p><p>不应包含</p></section>', '指定段落'],
  ['不把整组脚注当成单条', '<aside epub:type="footnotes"><p><a id="note">5</a>目标</p><p>其他脚注</p></aside>', '5目标'],
  ['空锚点仍获取所在段落', '<p><a id="note"></a>完整解释</p>', '完整解释'],
])('内联引用读取其语义上下文：%s', async (_label, html, expected) => {
  const target = new DOMParser().parseFromString(html, 'text/html');
  const source = new DOMParser().parseFromString('<p>来源</p>', 'text/html');
  const targetSection = { ...sections[0], id: 'OPS/notes.xhtml', createDocument: async () => target };
  const result = await previewEpubLink('notes.xhtml#note', [...sections, targetSection], 0, source);
  expect(result.text).toBe(expected);
  expect(result).toMatchObject({ index: 1, fragment: 'note', address: 'OPS/notes.xhtml#note' });
  expect(target.getElementById('note')).not.toBeNull();
});

it.each(['footnote', 'endnote'])('XHTML 命名空间别名也保留单条 %s 的多段解释', async type => {
  const target = new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:e="http://www.idpf.org/2007/ops"><body><aside e:type="${type}"><p><a id="note">9</a>第一段</p><p>第二段</p></aside><p>相邻正文</p></body></html>`, 'application/xhtml+xml');
  const result = await previewEpubLink('#note', sections, 0, target);
  expect(result.text).toBe('9第一段第二段');
  expect(result).toMatchObject({ index: 0, fragment: 'note' });
});
it.each(['aside', 'div'])('无显式脚注语义的局部 %s 仍能预览直属锚点旁文字', async tag => {
  const target = new DOMParser().parseFromString(`<${tag}><a id="note"></a>这是单条注释解释。</${tag}><p>无关正文</p>`, 'text/html');
  expect((await previewEpubLink('#note', sections, 0, target)).text).toBe('这是单条注释解释。');
});
it('局部容器回退不带出集合中的其他块级注释', async () => {
  const target = new DOMParser().parseFromString('<aside><a id="note"></a><p>无法确认属于该锚点的第一条</p><p>另一条</p></aside>', 'text/html');
  expect((await previewEpubLink('#note', sections, 0, target)).text).toBe('此处没有可预览的文字。');
});
