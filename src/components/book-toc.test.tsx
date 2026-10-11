// @vitest-environment jsdom
import { act } from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {BookToc} from './book-toc';
it('渲染原书层级、同文件不同目录项及原生href，不展示spine占位章节',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),open=vi.fn();
 const items=[{id:'part',label:'第一编',children:[{id:'a',label:'第一章',href:'chapter.xhtml#one',chapterId:'c',children:[]},{id:'b',label:'第二节',href:'chapter.xhtml#two',chapterId:'c',children:[]}]}];
 try{
  await act(async()=>root.render(<BookToc items={items} currentChapterId="c" activeId="b" onOpen={open}/>));
  expect(host.querySelectorAll('ol ol')).toHaveLength(1);expect(host.querySelectorAll('[aria-current="location"]')).toHaveLength(1);expect(host.querySelector('[aria-current="location"]')?.textContent).toBe('第二节');
  expect(host.querySelector('button')?.disabled).toBe(true);const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='第二节')!;
  await act(async()=>button.click());expect(open).toHaveBeenCalledWith(items[0].children[1]);expect(host.textContent).not.toContain('未命名');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
