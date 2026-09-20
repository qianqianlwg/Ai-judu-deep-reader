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
