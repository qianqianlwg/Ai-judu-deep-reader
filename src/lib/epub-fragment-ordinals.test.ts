import { expect, it, vi } from 'vitest';
import { epubFragmentOrdinals } from './epub-fragment-ordinals';
it('按元素边界记录容器标题、段落、内联片段和空元素，不推断标题',()=>{
 expect(epubFragmentOrdinals('<section id="part"><h1 id="title">章</h1><p id="para">前<span id="inline">后</span></p></section><p></p><div id="tail">结束</div>')).toEqual({part:0,title:0,para:1,inline:1,tail:3});
});
it('未包含真实内容块的片段不假造位置，重复ID只拒绝对应应用锚点但不阻断整书导入',()=>{
 expect(epubFragmentOrdinals('<img id="cover"/><p>正文</p>')).toEqual({});
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try {expect(epubFragmentOrdinals('<p id="x">甲</p><p id="x">乙</p><p id="valid">丙</p>')).toEqual({valid:2});expect(warning).toHaveBeenCalledOnce();}finally{warning.mockRestore();}
});
