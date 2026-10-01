"use client";

import {useEffect, useRef, type KeyboardEvent} from "react";
import "./import-book-dialog.css";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type ImportBookDialogProps = {
  onClose: () => void;
  onChoose: (autoIndex: boolean) => void;
};

export function ImportBookDialog({onClose, onChoose}: ImportBookDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const option = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const trigger = document.activeElement;
    option.current?.focus();
    return () => {
      // WHY：关闭自绘模态层后，把键盘焦点还给打开它的控件。
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({preventScroll: true});
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const root = dialog.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hidden && !element.closest("[hidden]"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="import-book-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCloseRef.current();}}>
    <section ref={dialog} className="import-book-dialog" role="dialog" aria-modal="true" aria-labelledby="import-book-title" onKeyDown={handleKeyDown}>
      <header><div><p>加入书库</p><h2 id="import-book-title">导入书籍</h2></div><button type="button" aria-label="取消导入" onClick={()=>onCloseRef.current()}>×</button></header>
      <p>导入后即可在知识库使用本地关键词检索，不需要额外建库。</p>
      <label className="import-book-option"><input ref={option} type="checkbox"/><span><strong>导入后自动建立语义索引</strong><small>会将本书文字发送至 SiliconFlow，可能产生费用；须先在设置中配置服务。进度可暂停，失败后可在知识库继续。</small></span></label>
      <footer><a href="/settings">配置语义服务</a><button type="button" onClick={()=>onCloseRef.current()}>取消</button><button type="button" className="import-book-primary" onClick={() => onChoose(option.current?.checked === true)}>选择书籍文件</button></footer>
    </section>
  </div>;
}
