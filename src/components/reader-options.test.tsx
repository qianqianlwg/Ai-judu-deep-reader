// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';import {expect,it,vi} from 'vitest';
import {ReaderOptions} from './reader-options';import {DEFAULT_READING_APPEARANCE} from '@/lib/reading-appearance';
it('选项可打开、修改主题、复位并用Escape关闭',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const el=document.createElement('div');document.body.append(el);const root=createRoot(el);const change=vi.fn();
 try{await act(async()=>root.render(<ReaderOptions value={DEFAULT_READING_APPEARANCE} onChange={change}/>));
 await act(async()=>el.querySelector('button')!.click());expect(el.querySelector('[aria-label="阅读选项"]')).not.toBeNull();
 const select=el.querySelector<HTMLSelectElement>('[aria-label="阅读主题"]')!;await act(async()=>{select.value='dark';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(change).toHaveBeenCalledWith(expect.objectContaining({theme:'dark'}));
 await act(async()=>Array.from(el.querySelectorAll('button')).find(b=>b.textContent==='恢复默认外观')!.click());expect(change).toHaveBeenLastCalledWith(DEFAULT_READING_APPEARANCE);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(el.querySelector('[aria-label="阅读选项"]')).toBeNull();expect(document.activeElement).toBe(el.querySelector('button'));
 }finally{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();}
});
