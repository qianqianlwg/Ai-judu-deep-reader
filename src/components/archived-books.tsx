"use client";
import {useEffect,useState} from 'react';
import {readLibraryResponse,type LibraryBook} from '@/lib/library';
import {BookShelfAction} from './book-shelf-action';
export function ArchivedBooks({revision=0,busy=false,onRestored}:{revision?:number;busy?:boolean;onRestored:()=>void}){
 const [open,setOpen]=useState(false),[books,setBooks]=useState<LibraryBook[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open)return;const controller=new AbortController();
  void(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/library?shelf=archived',{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('读取已下架书籍失败（HTTP '+response.status+'）');const data=readLibraryResponse(await response.json());if(!controller.signal.aborted)setBooks(data);}catch(cause:unknown){if(!controller.signal.aborted){console.error('读取已下架书籍失败',cause);setError(cause instanceof Error?cause.message:'读取失败，请重试');}}finally{if(!controller.signal.aborted)setLoading(false);}})();
  return()=>controller.abort();
 },[open,revision,retry]);
 return <details className="archived-books" onToggle={event=>setOpen(event.currentTarget.open)}><summary>已下架书籍{open?'（'+books.length+'）':''}</summary><p>这里的书籍没有被删除。恢复后会重新出现在书架，历史记录和阅读位置仍保留。</p>
 {loading&&<p role="status">正在读取已下架书籍…</p>}{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(value=>value+1)}>重新加载</button></p>}
 {!loading&&!error&&books.length===0&&<p>暂无已下架书籍</p>}
 {!error&&<div className="archived-books-list">{books.map(book=><article key={book.id}><strong>{book.title}</strong><p>{book.author||'作者未注明'} · {book.editions?.length??0} 个版本 · {book.id.slice(0,8)}</p><BookShelfAction bookId={book.id} title={book.title} archived disabled={busy||loading} onChanged={()=>{setBooks(items=>items.filter(item=>item.id!==book.id));onRestored();}}/></article>)}</div>}
 </details>;
}
