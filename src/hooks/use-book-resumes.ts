"use client";
import {useEffect,useState} from 'react';
import {BOOK_RESUME_CHANGED,readBookResumes} from '@/lib/book-resume';
import {readShelfHistory,SHELF_HISTORY_PREFIX,type ShelfHistory} from "@/lib/bookshelf-history";
import type {LibraryBook} from '@/lib/library';
export function useBookResumes(books:readonly LibraryBook[]){
 const [history,setHistory]=useState<Record<string,ShelfHistory>>({});
 const [editions,setEditions]=useState<Record<string,string>>({}),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  const refresh=()=>{if(!active)return;try{setEditions(readBookResumes(localStorage,books));setHistory(readShelfHistory(localStorage,books));setError('');}catch(cause:unknown){console.warn('读取各书阅读记录失败',cause);setError('无法读取阅读记录，请检查浏览器存储权限；书籍和阅读记录未被删除。');}};
  const storage=(event:StorageEvent)=>{if(event.key===null||(event.key.startsWith('judu:edition:')||event.key.startsWith(SHELF_HISTORY_PREFIX)))refresh();};
  // WHY：延后读浏览器存储以兼容服务端首屏；同页事件与跨标签 storage 事件分别刷新，不轮询、不覆盖其他书的记录。
  queueMicrotask(refresh);window.addEventListener(BOOK_RESUME_CHANGED,refresh);window.addEventListener('storage',storage);window.addEventListener('focus',refresh);
  return()=>{active=false;window.removeEventListener(BOOK_RESUME_CHANGED,refresh);window.removeEventListener('storage',storage);window.removeEventListener('focus',refresh);};
 },[books]);
 return {editions,error,history};
}
