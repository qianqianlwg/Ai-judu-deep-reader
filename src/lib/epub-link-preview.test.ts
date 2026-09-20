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
