"use client";
import {useRef,useState} from 'react';
import './book-shelf-action.css';
type Props={bookId:string;title:string;archived?:boolean;disabled?:boolean;onChanged:()=>void};
export function BookShelfAction({bookId,title,archived=false,disabled=false,onChanged}:Props){
 const [confirm,setConfirm]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function change(){if(disabled||lock.current)return;lock.current=true;setPending(true);setError('');
  try{const response=await fetch('/api/books/'+encodeURIComponent(bookId)+'/shelf',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:!archived})});const value:unknown=await response.json();
   if(!response.ok)throw new Error(value&&typeof value==='object'&&'error' in value&&typeof value.error==='string'?value.error:'书架状态更新失败，请重试');
   if(!value||typeof value!=='object'||!('bookId' in value)||value.bookId!==bookId||!('archived' in value)||value.archived!==!archived)throw new Error('服务返回的书架状态不匹配，请刷新书架确认');
   setConfirm(false);onChanged();
  }catch(cause:unknown){console.error('书籍下架/恢复失败',cause);setError(cause instanceof Error?cause.message:'操作失败，请重试');}
  finally{lock.current=false;setPending(false);}
 }
 return <div className="book-shelf-action">
  {!confirm&&<button type="button" disabled={disabled||pending} aria-label={(archived?'恢复上架《':'下架《')+title+'》'} onClick={()=>archived?void change():setConfirm(true)}>{pending?'处理中…':archived?'恢复上架':'下架'}</button>}
  {confirm&&<div className="book-shelf-confirm" role="group" aria-label={'确认下架《'+title+'》'}><p>下架《{title}》及其所有版本？</p><p>只从书架隐藏，原文件、标注、笔记、对话和向量索引均保留，可在“已下架”中恢复。当前已打开的正文不强制关闭。</p><div><button type="button" autoFocus disabled={disabled||pending} onClick={()=>setConfirm(false)}>取消</button><button type="button" disabled={disabled||pending} onClick={()=>void change()}>{pending?'正在下架…':'确认下架'}</button></div></div>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
