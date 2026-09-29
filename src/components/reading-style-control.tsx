'use client';
import { useSyncExternalStore } from 'react';
import { READING_STYLE_KEY, readReadingStyle, type ReadingStyle } from '@/lib/semantic-reading';
import './semantic-reading.css';
const changed='judu:reading-style-changed';
function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener(changed,callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener(changed,callback);};}
function snapshot(){return readReadingStyle(localStorage.getItem(READING_STYLE_KEY));}
export function useReadingStyle(onError:(message:string)=>void){
 const style=useSyncExternalStore(subscribe,snapshot,()=> 'semantic' as const);
 const change=(value:ReadingStyle)=>{try{localStorage.setItem(READING_STYLE_KEY,value);window.dispatchEvent(new Event(changed));}catch(cause:unknown){console.error('保存句读方式失败',cause);onError('句读方式保存失败，请检查浏览器存储。');}};
 return {style,change};
}
export function ReadingStyleControl({value,onChange,disabled=false,compact=false}:{value:ReadingStyle;onChange:(v:ReadingStyle)=>void;disabled?:boolean;compact?:boolean}){
 return <label className={'reading-style-control'+(compact?' compact':'')}><span>句读方式</span><select aria-label='句读方式' value={value} disabled={disabled} onChange={event=>onChange(readReadingStyle(event.target.value))}><option value='semantic'>按句意细读</option><option value='whole'>整段句读 · 原有</option></select></label>;
}
