// @vitest-environment jsdom
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

type Paginator=HTMLElement&{setVisibleRangeForTest(range:Range):void;next():Promise<void>;prev():Promise<void>;destroy():void};
let serial=0,paginator:Paginator;
beforeEach(async()=>{
 vi.useFakeTimers();
 const raw=await readFile('public/vendor/foliate/paginator.js','utf8');
 // WHY：测试VM仅注入可见范围几何，仍执行分发文件的真实selectionchange和700ms延迟逻辑；产品shadow与iframe不改。
 const source=raw.replace('export class Paginator','class Paginator').replace('    #lastVisibleRange','    setVisibleRangeForTest(range) { this.#lastVisibleRange = range }\n    #lastVisibleRange').replace("customElements.define('foliate-paginator', Paginator)",`customElements.define('selection-boundary-${++serial}', Paginator)\nPaginator`);
 const PaginatorClass=runInNewContext(source,{document,HTMLElement,customElements,NodeFilter,DOMRect,DOMException,Event,CustomEvent,Range,console,setTimeout,clearTimeout,AbortController,innerWidth:1000,innerHeight:800,ResizeObserver:class{observe(){}disconnect(){}},matchMedia:()=>({addEventListener(){},removeEventListener(){}})}) as new()=>Paginator;
 paginator=new PaginatorClass();
 document.body.innerHTML='<p>第一页末尾下一页正文</p>';
 const node=document.querySelector('p')!.firstChild!,visible=document.createRange();visible.setStart(node,0);visible.setEnd(node,6);
 paginator.setVisibleRangeForTest(visible);
 paginator.dispatchEvent(new CustomEvent('load',{detail:{doc:document}}));
});
afterEach(()=>{paginator.destroy();document.getSelection()?.removeAllRanges();document.body.innerHTML='';vi.useRealTimers();vi.restoreAllMocks();});
function dragPastBoundary(){
 const node=document.querySelector('p')!.firstChild!,selection=document.getSelection()!;
 selection.setBaseAndExtent(node,0,node,8);
 document.dispatchEvent(new MouseEvent('pointerdown',{button:0}));
 document.dispatchEvent(new Event('selectionchange'));
}
describe('页尾拖选不意外翻页',()=>{
 it('开启产品属性后700ms及松手后的迟到任务均不翻页',async()=>{
  paginator.setAttribute('disable-pointer-selection-navigation','');const next=vi.spyOn(paginator,'next').mockResolvedValue();
  dragPastBoundary();document.dispatchEvent(new MouseEvent('pointerup',{button:0}));
  await vi.advanceTimersByTimeAsync(1000);expect(next).not.toHaveBeenCalled();expect(document.getSelection()!.toString()).toBe('第一页末尾下一页');
 });
 it('排队后再关闭自动翻页仍阻止旧任务，上游默认行为保持',async()=>{
  const next=vi.spyOn(paginator,'next').mockResolvedValue();dragPastBoundary();
  paginator.setAttribute('disable-pointer-selection-navigation','');await vi.advanceTimersByTimeAsync(800);expect(next).not.toHaveBeenCalled();
  paginator.removeAttribute('disable-pointer-selection-navigation');dragPastBoundary();await vi.advanceTimersByTimeAsync(800);expect(next).toHaveBeenCalledOnce();
 });
});
