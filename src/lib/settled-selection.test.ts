// @vitest-environment jsdom
import {describe,it,expect,vi} from 'vitest';
import {bindSettledSelection} from './settled-selection';
describe('选文完成门控',()=>{
 it('按住拖选和停顿不提交，文档外缘松开才提交',()=>{const root=document.createElement('div');document.body.append(root);const commit=vi.fn(),start=vi.fn();const clean=bindSettledSelection(root,{onCommit:commit,onStart:start});root.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));for(let i=0;i<5;i++)document.dispatchEvent(new Event('selectionchange'));expect(start).toHaveBeenCalledTimes(1);expect(commit).not.toHaveBeenCalled();document.dispatchEvent(new MouseEvent('pointerup',{button:0}));expect(commit).toHaveBeenCalledTimes(1);clean();document.dispatchEvent(new Event('selectionchange'));expect(commit).toHaveBeenCalledTimes(1);root.remove();});
 it('指针取消不提交，新的键盘选区可用，右键忽略',()=>{const root=document.createElement('div');document.body.append(root);const commit=vi.fn(),cancel=vi.fn(),start=vi.fn();const clean=bindSettledSelection(root,{onCommit:commit,onStart:start,onCancel:cancel});root.dispatchEvent(new MouseEvent('pointerdown',{button:2}));expect(start).not.toHaveBeenCalled();root.dispatchEvent(new MouseEvent('pointerdown',{button:0}));document.dispatchEvent(new Event('pointercancel'));document.dispatchEvent(new Event('selectionchange'));expect(commit).not.toHaveBeenCalled();root.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}));expect(commit).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1);clean();root.remove();});
 it('已完成选区切到工具栏时失焦不清空，仅拖选中的取消清空',()=>{
  const root=document.createElement('div');document.body.append(root);
  const commit=vi.fn(),cancel=vi.fn(),start=vi.fn();
  const clean=bindSettledSelection(root,{onCommit:commit,onStart:start,onCancel:cancel});
  root.dispatchEvent(new MouseEvent('pointerdown',{button:0}));
  document.dispatchEvent(new MouseEvent('pointerup',{button:0}));
  expect(commit).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('blur'));
  expect(cancel).not.toHaveBeenCalled();
  root.dispatchEvent(new MouseEvent('pointerdown',{button:0}));
  window.dispatchEvent(new Event('blur'));
  expect(cancel).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event('selectionchange'));
  expect(commit).toHaveBeenCalledTimes(1);
  clean();root.remove();
 });});

it('iframe 内确认的选区点击外层空白一次取消，且操作按钮不取消',()=>{
 const iframe=document.createElement('iframe');document.body.append(iframe);const doc=iframe.contentDocument!;doc.body.innerHTML='<p>待句读的原文</p>';
 const range=doc.createRange();range.selectNodeContents(doc.querySelector('p')!);doc.getSelection()!.addRange(range);
 const commit=vi.fn(),cancel=vi.fn();const clean=bindSettledSelection(doc,{onCommit:commit,onStart:vi.fn(),onCancel:cancel});
 doc.dispatchEvent(new Event('selectionchange'));expect(commit).toHaveBeenCalledOnce();
 const action=document.createElement('button');document.body.append(action);action.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));expect(cancel).not.toHaveBeenCalled();
 document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));document.dispatchEvent(new MouseEvent('mouseup',{button:0}));doc.dispatchEvent(new Event('selectionchange'));
 expect(cancel).toHaveBeenCalledOnce();expect(doc.getSelection()!.rangeCount).toBe(0);expect(commit).toHaveBeenCalledOnce();clean();action.remove();iframe.remove();
});

it('原版 Document 内空白区域一次点击即撤销已确认的选区和状态', () => {
 const frame=document.createElement('iframe');document.body.append(frame);
 const doc=frame.contentDocument!;doc.body.innerHTML='<p>选中的正文</p><p>其他正文</p>';
 const range=doc.createRange();range.selectNodeContents(doc.querySelector('p')!);doc.getSelection()!.addRange(range);
 const commit=vi.fn(),cancel=vi.fn(),start=vi.fn();const cleanup=bindSettledSelection(doc,{onCommit:commit,onStart:start,onCancel:cancel});
 doc.dispatchEvent(new Event('selectionchange'));expect(commit).toHaveBeenCalledOnce();
 doc.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));
 doc.dispatchEvent(new MouseEvent('mouseup',{button:0}));doc.dispatchEvent(new Event('selectionchange'));
 expect(doc.getSelection()!.rangeCount).toBe(0);expect(cancel).toHaveBeenCalledOnce();expect(start).not.toHaveBeenCalled();expect(commit).toHaveBeenCalledOnce();
 cleanup();frame.remove();
});
