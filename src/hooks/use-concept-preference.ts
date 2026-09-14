"use client";
import { useSyncExternalStore } from "react";
const KEY="judu:showConcepts",EVENT="judu:concept-preference";
const snapshot=()=>localStorage.getItem(KEY)!=="false";
const subscribe=(notify:()=>void)=>{window.addEventListener("storage",notify);window.addEventListener(EVENT,notify);return()=>{window.removeEventListener("storage",notify);window.removeEventListener(EVENT,notify);};};
export function setConceptPreference(value:boolean):void{localStorage.setItem(KEY,String(value));window.dispatchEvent(new Event(EVENT));}
export function useConceptPreference(){
 // WHY：读取持久化的概念开关属于浏览器外部状态；server snapshot 固定，避免水合不一致和每次刷新重置。
 return useSyncExternalStore(subscribe,snapshot,()=>true);
}
