// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImportBookDialog} from './import-book-dialog';
let host:HTMLDivElement;let root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('默认不授权云端索引，明确勾选后才在选择文件时传递授权',async()=>{
 const choose=vi.fn(),close=vi.fn();await act(async()=>root.render(<ImportBookDialog onChoose={choose} onClose={close}/>));
 expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
 expect(host.querySelector('input')?.checked).toBe(false);
 act(()=>host.querySelector<HTMLButtonElement>('.import-book-primary')!.click());expect(choose).toHaveBeenCalledWith(false);
 act(()=>{host.querySelector<HTMLInputElement>('input')!.click();host.querySelector<HTMLButtonElement>('.import-book-primary')!.click();});expect(choose).toHaveBeenLastCalledWith(true);
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(close).toHaveBeenCalledOnce();
});
