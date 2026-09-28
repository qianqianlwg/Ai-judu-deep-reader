"use client";

import {useEffect, useRef} from "react";
import "./import-book-dialog.css";

export function ImportBookDialog({onClose,onChoose}:{onClose:()=>void;onChoose:(autoIndex:boolean)=>void}) {
  const option = useRef<HTMLInputElement>(null);
  const choose = () => onChoose(option.current?.checked === true);
  useEffect(() => {
    option.current?.focus();
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    window.addEventListener("keydown",escape);
    return ()=>window.removeEventListener("keydown",escape);
  },[onClose]);
  return <div className="import-book-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="import-book-dialog" role="dialog" aria-modal="true" aria-labelledby="import-book-title">
      <header><div><p>加入书库</p><h2 id="import-book-title">导入书籍</h2></div><button type="button" aria-label="取消导入" onClick={onClose}>×</button></header>
      <p>导入后即可在知识库使用本地关键词检索，不需要额外建库。</p>
      <label className="import-book-option"><input ref={option} type="checkbox"/><span><strong>导入后自动建立语义索引</strong><small>会将本书文字发送至 SiliconFlow，可能产生费用；须先在设置中配置服务。进度可暂停，失败后可在知识库继续。</small></span></label>
      <footer><a href="/settings">配置语义服务</a><button type="button" onClick={onClose}>取消</button><button type="button" className="import-book-primary" onClick={choose}>选择书籍文件</button></footer>
    </section>
  </div>;
}
