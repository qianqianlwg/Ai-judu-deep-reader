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

it('快速选项可修改字号、行距与字距',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const el=document.createElement('div');document.body.append(el);const root=createRoot(el);const change=vi.fn();
 try{await act(async()=>root.render(<ReaderOptions value={DEFAULT_READING_APPEARANCE} onChange={change}/>));await act(async()=>el.querySelector('button')!.click());
 const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 const size=el.querySelector<HTMLInputElement>('[aria-label="阅读字号"]')!;
 await act(async()=>{setValue.call(size,'24');size.dispatchEvent(new Event('input',{bubbles:true}));size.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(change).toHaveBeenCalledWith(expect.objectContaining({fontSize:24}));
 const height=el.querySelector<HTMLSelectElement>('[aria-label="阅读行距"]')!;
 await act(async()=>{height.value='2.2';height.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(change).toHaveBeenCalledWith(expect.objectContaining({lineHeight:2.2}));
 const spacing=el.querySelector<HTMLInputElement>('[aria-label="阅读字距"]')!;expect(spacing).not.toBeNull();
 await act(async()=>{setValue.call(spacing,'0.05');spacing.dispatchEvent(new Event('input',{bubbles:true}));spacing.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(change).toHaveBeenCalledWith(expect.objectContaining({letterSpacing:.05}));
 }finally{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();}
});

it("阅读快捷选项列出霞鹜文楷", async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const el=document.createElement('div');document.body.append(el);const root=createRoot(el);const change=vi.fn();
 try {
  await act(async () => root.render(<ReaderOptions value={DEFAULT_READING_APPEARANCE} onChange={change}/>));
  await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="更多阅读选项"]')!.click());
  const select=el.querySelector<HTMLSelectElement>('select[aria-label="阅读字体"]')!;
  expect(Array.from(select.options).some(option => option.value === "wenkai" && option.textContent === "霞鹜文楷")).toBe(true);
  await act(async () => { select.value='wenkai';select.dispatchEvent(new Event('change',{bubbles:true})); });
  expect(change).toHaveBeenCalledWith(expect.objectContaining({font:'wenkai'}));
 } finally { await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals(); }
});

it("快捷选项可开启原版统一字体且默认关闭", async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const el=document.createElement("div");document.body.append(el);const root=createRoot(el);const change=vi.fn();
 try {
  await act(async()=>root.render(<ReaderOptions value={DEFAULT_READING_APPEARANCE} onChange={change}/>));
  await act(async()=>el.querySelector<HTMLButtonElement>('[aria-label="更多阅读选项"]')!.click());
  const input=el.querySelector<HTMLInputElement>('[aria-label="原版正文统一使用阅读字体"]')!;
  expect(input.checked).toBe(false);
  expect(input.parentElement?.textContent).toContain("未开启");
  await act(async()=>input.click());
  expect(change).toHaveBeenCalledWith(expect.objectContaining({originalBodyFontOverride:true}));
 } finally {await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();}
});