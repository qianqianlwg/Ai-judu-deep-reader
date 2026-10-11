// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {HISTORY_JUMP_EVENT,revealHistoryTarget} from './reader-history-navigation';
let scroller:HTMLDivElement,node:HTMLElement,source:HTMLDetailsElement;
const scrollTo=vi.fn();
beforeEach(()=>{
 scroller=document.createElement('div');scroller.innerHTML='<article data-history-target="true"></article><details><summary>句读</summary><article tabindex="-1"></article></details>';document.body.append(scroller);
 source=scroller.querySelector('details')!;node=source.querySelector('article')!;
 Object.defineProperties(scroller,{clientHeight:{value:600,configurable:true},scrollHeight:{value:2000,configurable:true},scrollTo:{value:scrollTo,configurable:true}});
 scroller.scrollTop=500;vi.spyOn(scroller,'getBoundingClientRect').mockReturnValue(new DOMRect(0,100,400,600));
 vi.spyOn(node,'getBoundingClientRect').mockImplementation(()=>{expect(source.open).toBe(true);expect(node.hasAttribute('data-history-target')).toBe(false);return new DOMRect(0,450,350,100);});
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));scrollTo.mockClear();
});
afterEach(()=>{scroller.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('展开目标祖先后平滑定位到视窗20%处，暂停跟随并强调正确子块',()=>{
 const pause=vi.fn(),focus=vi.spyOn(node,'focus');scroller.addEventListener(HISTORY_JUMP_EVENT,pause);
 revealHistoryTarget(node,scroller);
 expect(scrollTo).toHaveBeenCalledWith({top:730,behavior:'smooth'});expect(pause).toHaveBeenCalledOnce();expect(node.dataset.historyTarget).toBe('true');expect(scroller.querySelectorAll('[data-history-target]')).toHaveLength(1);expect(focus).toHaveBeenCalledWith({preventScroll:true});
 revealHistoryTarget(node,scroller);expect(scrollTo).toHaveBeenCalledTimes(2);
});
it.each([[0,0],[3000,1400]])('目标靠近边界时钳制合法位置，不要求定格在20%：%s', (targetTop,expected)=>{
 vi.mocked(node.getBoundingClientRect).mockReturnValue(new DOMRect(0,targetTop,350,100));scroller.scrollTop=0;
 revealHistoryTarget(node,scroller);expect(scrollTo).toHaveBeenCalledWith({top:expected,behavior:'smooth'});
});
it('减少动态效果偏好使用即时跳转，缺少scrollTo时仍保持正确位置',()=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true})));revealHistoryTarget(node,scroller);expect(scrollTo).toHaveBeenCalledWith({top:730,behavior:'auto'});
 Object.defineProperty(scroller,'scrollTo',{value:undefined});revealHistoryTarget(node,scroller);expect(scroller.scrollTop).toBe(730);
});
it('强调覆盖语义子块和整条消息，结束淡出而不改变排版',async()=>{
 const css=await readFile('src/components/workspace-nav.css','utf8');expect(css).toContain('.analysis-panel [data-history-target="true"]');expect(css).toContain('reader-history-target 2.4s');expect(css).toContain('100% { outline-color: transparent');
});
