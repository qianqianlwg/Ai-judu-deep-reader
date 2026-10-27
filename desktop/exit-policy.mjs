// @ts-check
/** @param {{busy:()=>Promise<number>;choose:(count:number)=>Promise<'wait'|'cancel'|'force'>;waiting:()=>boolean;pause:()=>Promise<void>;onWaiting:(waiting:boolean)=>void}} options */
export async function confirmDesktopExit(options){
 const count=await options.busy();if(count===0)return true;
 const choice=await options.choose(count);
 if(choice==='cancel')return false;
 if(choice==='force')return true;
 options.onWaiting(true);
 try{while(options.waiting()){await options.pause();if(await options.busy()===0)return options.waiting();}return false;}
 finally{options.onWaiting(false);}
}
