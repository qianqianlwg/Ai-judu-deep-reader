// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImportBookDialog} from './import-book-dialog';

let host:HTMLDivElement;
let root:ReturnType<typeof createRoot>;
let mounted=false;

beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  host=document.createElement('div');
  document.body.append(host);
  root=createRoot(host);
  mounted=false;
});

afterEach(()=>{
  if(mounted)act(()=>root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('默认不授权云端索引，明确勾选后才在选择文件时传递授权',async()=>{
  const choose=vi.fn(),close=vi.fn();
  await act(async()=>{
    root.render(<ImportBookDialog onChoose={choose} onClose={close}/>);
    mounted=true;
  });
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  expect(host.querySelector('input')?.checked).toBe(false);
  act(()=>host.querySelector<HTMLButtonElement>('.import-book-primary')!.click());
  expect(choose).toHaveBeenCalledWith(false);
  act(()=>{
    host.querySelector<HTMLInputElement>('input')!.click();
    host.querySelector<HTMLButtonElement>('.import-book-primary')!.click();
  });
  expect(choose).toHaveBeenLastCalledWith(true);
  const dialog=host.querySelector<HTMLElement>('[role="dialog"]')!;
  act(()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(close).toHaveBeenCalledOnce();
});

it('将 Tab 焦点限制在对话框内，并在卸载后恢复触发控件焦点',async()=>{
  const trigger=document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  await act(async()=>{
    root.render(<ImportBookDialog onChoose={vi.fn()} onClose={vi.fn()}/>);
    mounted=true;
  });
  const dialog=host.querySelector<HTMLElement>('[role="dialog"]')!;
  const close=dialog.querySelector<HTMLButtonElement>('header button')!;
  const primary=dialog.querySelector<HTMLButtonElement>('.import-book-primary')!;
  expect(document.activeElement).toBe(host.querySelector('input'));
  primary.focus();
  const forward=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
  act(()=>primary.dispatchEvent(forward));
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
  const backward=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});
  act(()=>close.dispatchEvent(backward));
  expect(backward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(primary);
  act(()=>root.unmount());
  mounted=false;
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
