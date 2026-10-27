// @ts-check
import {appendFile,stat,rename}from'node:fs/promises';import path from'node:path';
/** @param {string} profile @param {string} event @param {{port?:number;pid?:number;code?:number|null;recovered?:number}} [details] */
export async function logDesktopEvent(profile,event,details={}){
 const file=path.join(profile,'desktop-events.log');
 try{if((await stat(file)).size>256*1024)await rename(file,file+'.previous');}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
 // WHY：只记录显式运行状态，不落盘正文、URL、令牌、密钥或上游响应；最多保留两份受限日志。
 await appendFile(file,JSON.stringify({at:new Date().toISOString(),event,...details})+'\n',{mode:0o600});
}
