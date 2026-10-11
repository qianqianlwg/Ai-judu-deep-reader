"use client";
import {useRef,useState} from 'react';import {clearDeletedBookStorage} from '@/lib/book-deletion-storage';import {BOOK_RESUME_CHANGED} from '@/lib/book-resume';import styles from './book-delete-action.module.css';
type Props={bookId:string;title:string;disabled?:boolean;onDeleted:(notice:string)=>void;onPendingChange?:(pending:boolean)=>void};
export function BookDeleteAction({bookId,title,disabled=false,onDeleted,onPendingChange}:Props){
 const [confirm,setConfirm]=useState(false),[accepted,setAccepted]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function remove(){if(disabled||!accepted||lock.current)return;lock.current=true;setPending(true);onPendingChange?.(true);setError('');
  try{const response=await fetch('/api/books/'+encodeURIComponent(bookId)+'/data',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmBookId:bookId})});const value:unknown=await response.json();
   if(!response.ok)throw new Error(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string'?value.error:'永久删除失败，请重试');
   if(!value||typeof value!=='object'||!('bookId'in value)||value.bookId!==bookId||!('deleted'in value)||value.deleted!==true||!('editionIds'in value)||!Array.isArray(value.editionIds)||!value.editionIds.every((id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id)))throw new Error('删除结果无法确认，请刷新已下架列表核对');
   let notice='《'+title+'》及其应用内数据已永久删除。';
   try{clearDeletedBookStorage(localStorage,bookId,value.editionIds as string[]);window.dispatchEvent(new Event(BOOK_RESUME_CHANGED));}
   catch(cause:unknown){console.error('书籍已删除，但清理本地阅读缓存失败',cause);notice+='本浏览器的阅读缓存未能完整清理，请检查本地存储权限。';}
   onDeleted(notice);
  }catch(cause:unknown){console.error('永久删除书籍失败',cause);setError(cause instanceof Error?cause.message:'删除失败，请重试');}
  finally{lock.current=false;setPending(false);onPendingChange?.(false);}
 }
 return <div className={styles.action}>
  {!confirm?<button type="button" className={styles.delete} disabled={disabled||pending} aria-label={'永久删除《'+title+'》'} onClick={()=>{setConfirm(true);setAccepted(false);setError('');}}>永久删除</button>:<div className={styles.confirm} role="group" aria-label={'确认永久删除《'+title+'》'}>
   <strong>永久删除《{title}》及其所有版本？</strong><p>会删除应用内的原文件、转换文件、正文、标注、笔记、收藏、对话、导读及索引。开始后不可恢复；外部原始文件和独立备份不受影响。</p>
   <label><input type="checkbox" checked={accepted} disabled={disabled||pending} onChange={event=>setAccepted(event.target.checked)}/>我确认永久删除，理解此操作不可恢复</label>
   <div><button type="button" disabled={disabled||pending} onClick={()=>{setConfirm(false);setAccepted(false);}}>取消</button><button type="button" className={styles.delete} disabled={disabled||pending||!accepted} onClick={()=>void remove()}>{pending?'正在永久删除…':'确认永久删除'}</button></div>
  </div>}{error&&<p role="alert" className={styles.error}>{error}</p>}
 </div>;
}
