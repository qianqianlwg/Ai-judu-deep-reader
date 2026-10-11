'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { guidePreparationSchema,type GuidePreparation } from '@/lib/guide-preparation';
export type GuidePreparationScope={threadId:string;editionId:string;messageId:string};
export function useGuidePreparation(scope:GuidePreparationScope|null){
 const key=scope?scope.threadId+':'+scope.editionId+':'+scope.messageId:'',url=scope?'/api/threads/'+encodeURIComponent(scope.threadId)+'/guide-status?editionId='+encodeURIComponent(scope.editionId)+'&messageId='+encodeURIComponent(scope.messageId):'';
 const [snapshot,setSnapshot]=useState<{key:string;state:GuidePreparation|null;error:string}>({key:'',state:null,error:''});
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const active=useRef<{key:string;controller:AbortController}|null>(null);
 useEffect(()=>{
  if(!key)return;
  const context={key,controller:new AbortController()};active.current=context;let timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{
   if(document.hidden){timer=setTimeout(()=>void tick(),1800);return;}
   try{
    const response=await fetch(url,{cache:'no-store',signal:context.controller.signal});
    if(!response.ok)throw new Error('导图整理状态读取失败，请重新读取。');
    const state=guidePreparationSchema.parse(await response.json());if(state.messageId!==scope?.messageId)throw new Error('导图整理状态不属于当前句读。');
    if(active.current!==context||context.controller.signal.aborted)return;
    setSnapshot({key,state,error:''});
    if(['pending','processing','waiting'].includes(state.status))timer=setTimeout(()=>void tick(),1800);
   }catch(error:unknown){if(context.controller.signal.aborted||active.current!==context)return;console.error('读取句读导图状态失败',error);setSnapshot({key,state:null,error:error instanceof Error?error.message:'导图整理状态读取失败。'});}
  };
  void tick();return()=>{context.controller.abort();clearTimeout(timer);if(active.current===context)active.current=null;};
 },[key,url,scope?.messageId,revision]);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 const retry=useCallback(async()=>{
  const context=active.current;if(!context||context.key!==key||busy)return;
  setBusy(true);
  try{
   const response=await fetch(url,{method:'POST',signal:context.controller.signal});if(!response.ok)throw new Error('导图整理重试失败，请稍后再试。');
   const state=guidePreparationSchema.parse(await response.json());if(state.messageId!==scope?.messageId)throw new Error('重试状态不属于当前句读。');
   if(active.current===context&&!context.controller.signal.aborted){setSnapshot({key,state,error:''});refresh();}
  }catch(error:unknown){if(!context.controller.signal.aborted&&active.current===context){console.error('重试句读导图失败',error);setSnapshot(s=>({...s,key,error:error instanceof Error?error.message:'重试失败。'}));}}
  finally{setBusy(false);}
 },[key,url,scope?.messageId,busy,refresh]);
 return {state:snapshot.key===key?snapshot.state:null,error:snapshot.key===key?snapshot.error:'',busy,retry,refresh};
}
