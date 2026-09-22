"use client";
import {useEffect} from "react";
import {writeShelfHistory} from "@/lib/bookshelf-history";
import type {ReadingAnchor} from "@/lib/pagination";
type Input={bookId:string;editionId?:string;active:boolean;anchor:ReadingAnchor|null;location:string;onError:(message:string)=>void};
export function useShelfHistoryRecorder({bookId,editionId,active,anchor,location,onError}:Input) {
  useEffect(()=>{
    if(!editionId||!active)return;
    let current=true;
    try {
      if(anchor)localStorage.setItem("judu:position:"+bookId+":"+editionId,JSON.stringify(anchor));
      writeShelfHistory(localStorage,bookId,{editionId,updatedAt:Date.now(),location:location.slice(0,300)||"已打开，尚未记录位置"});
    }catch(cause:unknown){console.error("保存阅读位置失败",cause);queueMicrotask(()=>{if(current)onError("阅读位置未能保存，请检查浏览器存储权限");});}
    return()=>{current=false;};
  },[bookId,editionId,active,anchor,location,onError]);
}
