"use client";
import {useEffect,useState} from 'react';
import {readLibraryResponse,type LibraryBook} from '@/lib/library';
import {BookDeleteAction} from './book-delete-action';
import {BookShelfAction} from './book-shelf-action';
export function ArchivedBooks({revision=0,busy=false,onRestored}:{revision?:number;busy?:boolean;onRestored:()=>void}){
 const [open,setOpen]=useState(false),[books,setBooks]=useState<LibraryBook[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[deleting,setDeleting]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{if(!open)return;const controller=new AbortController();
  void(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/library?shelf=archived',{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('读取已下架书籍失败（HTTP '+response.status+'）');const data=readLibraryResponse(await response.json());if(!controller.signal.aborted)setBooks(data);}catch(cause:unknown){if(!controller.signal.aborted){console.error('读取已下架书籍失败',cause);setError(cause instanceof Error?cause.message:'读取失败，请重试');}}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[open,revision,retry]);
 return <details className="archived-books" onToggle={event=>setOpen(event.currentTarget.open)}><summary>已下架书籍{open?'（'+books.length+'）':''}</summary><p>下架仅隐藏书籍，可以恢复并保留历史；需要清理应用内数据时，请使用“永久删除”，删除后不可恢复。</p>
 {notice&&<p role="status">{notice}</p>}{loading&&<p role="status">正在读取已下架书籍…</p>}{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(value=>value+1)}>重新加载</button></p>}
 {!loading&&!error&&books.length===0&&<p>暂无已下架书籍</p>}
 {!error&&<div className="archived-books-list">{books.map(book=><article key={book.id}><strong>{book.title}</strong><p>{book.author||'作者未注明'} · {book.editions?.length??0} 个版本 · {book.id.slice(0,8)}</p><BookShelfAction bookId={book.id} title={book.title} archived disabled={busy||loading||deleting} onChanged={()=>{setBooks(items=>items.filter(item=>item.id!==book.id));onRestored();}}/><BookDeleteAction bookId={book.id} title={book.title} disabled={busy||loading||deleting} onPendingChange={setDeleting} onDeleted={message=>{setBooks(items=>items.filter(item=>item.id!==book.id));setNotice(message);onRestored();}}/></article>)}</div>}
 </details>;
}
