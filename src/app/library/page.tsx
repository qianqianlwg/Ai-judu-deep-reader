"use client";
import {importFileSizeError,IMPORT_TOO_LARGE} from "@/lib/import-limits";
import {useBookResumes} from "@/hooks/use-book-resumes";
import {bookResumeHref} from "@/lib/book-resume";
import {BookShelfAction} from "@/components/book-shelf-action";
import {ArchivedBooks} from "@/components/archived-books";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {readBookResponse,type LibraryBookContent} from '@/lib/library';
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object';
async function responseValue(response:Response):Promise<unknown>{
 if(response.status===413)throw new Error(IMPORT_TOO_LARGE);
 let value:unknown;try{value=await response.json();}catch(cause:unknown){throw new Error('服务未返回完整数据（HTTP '+response.status+'），请重试',{cause});}
 if(!response.ok)throw new Error(record(value)&&typeof value.error==='string'?value.error:'请求失败（HTTP '+response.status+'）');return value;
}
export default function LibraryPage(){
 const [revision,setRevision]=useState(0);
 const [books,setBooks]=useState<LibraryBookContent[]>([]),[loading,setLoading]=useState(true),[importing,setImporting]=useState(false),[error,setError]=useState('');
 const resumes=useBookResumes(books);
 useEffect(()=>{const controller=new AbortController();void(async()=>{setLoading(true);setError('');try{const value=await responseValue(await fetch('/api/books',{signal:controller.signal}));if(!Array.isArray(value))throw new Error('书架响应格式不完整');const next=value.map((item:unknown)=>{if(!record(item)||typeof item.id!=='string')throw new Error('书籍信息不完整');return readBookResponse(item,item.id);});if(!controller.signal.aborted)setBooks(next);}catch(cause:unknown){if(!controller.signal.aborted){console.error('读取书架失败',cause);setError(cause instanceof Error?cause.message:'读取书架失败');}}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();},[revision]);
 async function importFile(file:File){const sizeError=importFileSizeError(file.size);if(sizeError){setError(sizeError);return;}setImporting(true);setError('');try{const form=new FormData();form.append('file',file);const value=await responseValue(await fetch('/api/import',{method:'POST',headers:{'X-Judu-Import-Response':'compact'},body:form}));if(!record(value)||typeof value.id!=='string'||typeof value.editionId!=='string')throw new Error('导入响应缺少版本信息');const imported=readBookResponse(value,value.id,value.editionId);setBooks(previous=>[imported,...previous.filter(book=>book.id!==imported.id)]);}catch(cause:unknown){console.error('导入书籍失败',cause);setError(cause instanceof Error?cause.message:'导入失败，请重试');}finally{setImporting(false);}}
 return <main className="library-shell">
  <header className="library-topbar"><Link className="library-brand" href="/"><span className="library-mark">句</span><span><b>句读</b><small>深度阅读器</small></span></Link><Link className="library-back" href="/">返回阅读器 →</Link></header>
  <section className="library-content"><div className="library-heading"><div><div className="library-kicker">MY LIBRARY</div><h1>我的书架</h1><p>选择一本书，继续你的深度阅读。单文件最大 300 MB。</p></div><label className="library-import">{importing?'正在导入…':'＋ 导入书籍'}<input type="file" aria-label="导入书籍文件" disabled={loading||importing} accept=".mobi,.epub,.pdf,.fb2,.fbz,.fb2.zip,.cbz,.txt,.md" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importFile(file);}}/></label></div>
   <ArchivedBooks revision={revision} busy={importing||loading} onRestored={()=>setRevision(value=>value+1)}/>
   {resumes.error&&<p role="status">{resumes.error}</p>}
   {error&&<p role="alert">{error}</p>}
   {loading?<div className="library-empty">正在读取书架……</div>:books.length===0?<div className="library-empty"><div className="empty-symbol">＋</div><h2>还没有书籍</h2><p>导入一本 MOBI、EPUB、PDF、FB2/FBZ、CBZ 或 TXT，开始第一次句读。</p></div>:<div className="book-grid">{books.map(book=><div className="library-book-entry" key={book.id}><Link className="book-card" href={bookResumeHref(book.id,resumes.editions[book.id])} key={book.id}><div className="book-cover"><span>句读</span><i>经典原著<br/>深度阅读</i></div><div className="book-card-info"><h2>{book.title}</h2><p>{book.author}</p><span>{book.chapters.length} 个章节</span><p>{resumes.editions[book.id]?"继续阅读":"打开阅读"}</p></div></Link><BookShelfAction bookId={book.id} title={book.title} disabled={loading||importing} onChanged={()=>{setBooks(items=>items.filter(item=>item.id!==book.id));setRevision(value=>value+1);}}/></div>)}</div>}
  </section>
 </main>;
}
