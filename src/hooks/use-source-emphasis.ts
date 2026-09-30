'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {sourceEmphasisSchema,type SourceEmphasis} from '@/lib/source-enhancement';
import type {ReadingStyle} from '@/lib/semantic-reading';
const responseSchema=z.object({marks:z.array(sourceEmphasisSchema),generated:z.number().optional(),usage:z.object({totalTokens:z.number()}).passthrough().optional()});
const EMPTY:SourceEmphasis[]=[];
type Options={bookId:string;editionId?:string;chapterId?:string;model?:string;readingStyle:ReadingStyle;revision:number;onError:(message:string)=>void};
export function useSourceEmphasis({bookId,editionId,chapterId,model,readingStyle,revision,onError}:Options){
 const [saved,setSaved]=useState<{editionId:string;marks:SourceEmphasis[];message?:string}>(),[busyEdition,setBusy]=useState<string|null>(null);
 const generation=useRef<AbortController|null>(null),sequence=useRef(0);
 useEffect(()=>{const controller=new AbortController(),request=++sequence.current;generation.current?.abort();if(!editionId)return;
  void(async()=>{try{const response=await fetch('/api/reading-emphasis?'+new URLSearchParams({bookId:bookId,editionId:editionId!}),{signal:controller.signal});if(!response.ok)throw new Error('原文重点读取失败');const result=responseSchema.parse(await response.json());if(!controller.signal.aborted&&request===sequence.current)setSaved({editionId:editionId!,marks:result.marks});}catch(error:unknown){if(!controller.signal.aborted){console.error('读取原文重点失败',error);onError('原文重点读取失败，可刷新重试。');}}})();
  return()=>{controller.abort();generation.current?.abort();};
 },[bookId,editionId,revision,onError]);
 const generate=useCallback(async()=>{if(!editionId||!chapterId||generation.current)return;const controller=new AbortController();generation.current=controller;const request=++sequence.current;setBusy(editionId);
  try{const response=await fetch('/api/reading-emphasis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:bookId,editionId:editionId,chapterId:chapterId,model:model,readingStyle:readingStyle}),signal:controller.signal});const body:unknown=await response.json();if(!response.ok)throw new Error(body&&typeof body==='object'&&'error'in body&&typeof body.error==='string'?body.error:'重点生成失败');const result=responseSchema.parse(body);if(!controller.signal.aborted&&request===sequence.current)setSaved({editionId:editionId,marks:result.marks,message:result.generated?'本次生成 '+result.generated+' 处重点'+(result.usage?' · '+result.usage.totalTokens+' Token':''):'Agent 未发现需要额外标记的重点。'});
  }catch(error:unknown){if(!controller.signal.aborted){console.error('生成原文重点失败',error);onError(error instanceof Error?error.message:'重点生成失败');}}finally{if(generation.current===controller){generation.current=null;setBusy(null);}}
 },[bookId,editionId,chapterId,model,readingStyle,onError]);
 const current=saved?.editionId===editionId?saved:undefined;
 return {marks:current?.marks??EMPTY,busy:busyEdition===editionId,generate,status:current?.message??(current?.marks.length?'当前版本已有 '+current.marks.length+' 处 Agent 原文重点。':'尚无原文重点；开启显示不会自动调用模型。')};
}
