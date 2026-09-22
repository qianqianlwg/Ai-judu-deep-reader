"use client";
import {useRef,useState} from "react";
import type {LibraryBook} from "@/lib/library";
export function BookDisplayTitle({book,disabled,onSaved}:{book:LibraryBook;disabled?:boolean;onSaved:()=>void}) {
  const [title,setTitle]=useState(book.displayTitle || book.title),[error,setError]=useState(""),[pending,setPending]=useState(false);
  const lock=useRef(false);
  async function save(reset=false) {
    if (lock.current || disabled) return;
    lock.current=true;setPending(true);setError("");
    try {
      const response=await fetch("/api/books/"+encodeURIComponent(book.id)+"/display-title",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayTitle:reset?null:title})});
      const value: unknown=await response.json();
      if (!response.ok) throw new Error(value && typeof value==="object" && "error" in value && typeof value.error==="string" ? value.error : "保存失败，请重试");
      if (!value || typeof value!=="object" || !("bookId" in value) || value.bookId!==book.id || !("displayTitle" in value) || !(value.displayTitle===null || typeof value.displayTitle==="string")) throw new Error("保存响应无效，请刷新书架确认");
      setTitle(value.displayTitle ?? book.title);onSaved();
    } catch (cause: unknown) {console.error("保存显示书名失败",cause);setError(cause instanceof Error ? cause.message : "保存失败，请重试");}
    finally {lock.current=false;setPending(false);}
  }
  return <form className="bookshelf-title-form" onSubmit={event=>{event.preventDefault();void save();}}>
    <label>显示书名<input aria-label={"《"+book.title+"》的显示书名"} value={title} maxLength={200} required disabled={disabled||pending} onChange={event=>setTitle(event.target.value)}/></label>
    <small>仅修改书架名称，原始书名和文件名保持不变。</small>
    <div><button type="submit" disabled={disabled||pending||!title.trim()}>{pending?"保存中…":"保存书名"}</button>{book.displayTitle&&<button type="button" disabled={disabled||pending} onClick={()=>void save(true)}>恢复原名</button>}</div>
    {error&&<p role="alert">{error}</p>}
  </form>;
}
