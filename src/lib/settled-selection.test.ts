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


describe("跨文档焦点与已确认选文", () => {
 it.each(["button", "textarea"])("iframe 已松开后转到外层 %s，不取消已确认选区", (tag) => {
  const frame = document.createElement("iframe"), control = document.createElement(tag);
  document.body.append(frame, control);
  const doc = frame.contentDocument!, win = doc.defaultView!;
  doc.body.innerHTML = '<p tabindex="0">待标亮的原版文字</p>';
  const commit = vi.fn(), cancel = vi.fn();
  const clean = bindSettledSelection(doc, { onCommit: commit, onStart: vi.fn(), onCancel: cancel });
  const text = doc.querySelector("p")!;
  text.focus();
  text.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  doc.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
  expect(commit).toHaveBeenCalledOnce();
  control.focus();
  // WHY：jsdom 不发 iframe Window 的跨文档 blur；显式补齐浏览器在焦点转移时发出的事件。
  win.dispatchEvent(new Event("blur"));
  expect(document.activeElement).toBe(control);
  expect(cancel).not.toHaveBeenCalled();
  clean(); frame.remove(); control.remove();
 });
 it("拖选尚未释放时失焦仍取消，迟到的释放不提交，下次划选可以恢复", () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const doc = frame.contentDocument!, win = doc.defaultView!;
  const commit = vi.fn(), cancel = vi.fn();
  const clean = bindSettledSelection(doc, { onCommit: commit, onStart: vi.fn(), onCancel: cancel });
  doc.dispatchEvent(new MouseEvent("pointerdown", { button: 0 }));
  win.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
  doc.dispatchEvent(new Event("selectionchange"));
  expect(cancel).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
  doc.dispatchEvent(new MouseEvent("pointerdown", { button: 0 }));
  document.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
  expect(commit).toHaveBeenCalledOnce();
  clean(); win.dispatchEvent(new Event("blur")); expect(cancel).toHaveBeenCalledOnce(); frame.remove();
 });
 it("键盘选区确认后失焦不取消，但 pointercancel 仍清理", () => {
  const root = document.createElement("div"); document.body.append(root);
  const cancel = vi.fn(), commit = vi.fn();
  const clean = bindSettledSelection(root, { onCommit: commit, onStart: vi.fn(), onCancel: cancel });
  root.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true }));
  window.dispatchEvent(new Event("blur"));
  expect(commit).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled();
  document.dispatchEvent(new Event("pointercancel")); expect(cancel).toHaveBeenCalledOnce();
  clean(); root.remove();
 });
});
