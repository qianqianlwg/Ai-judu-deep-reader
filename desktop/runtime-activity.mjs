// @ts-check
import { subscribe,unsubscribe } from 'node:diagnostics_channel';
import { lstat } from 'node:fs/promises';import path from 'node:path';
import { busyDatabase } from './library.mjs';
/** @param {string} directory */
export function observeRuntimeActivity(directory){
 let requests=0;
 /** @param {unknown} message */
 const listener=message=>{
  if(!message||typeof message!=='object'||!('request'in message)||!('response'in message))return;
  const request=/** @type {import('node:http').IncomingMessage} */(message.request);
  const response=/** @type {import('node:http').ServerResponse} */(message.response);
  if(request.method==='GET'||request.method==='HEAD'||request.url==='/api/desktop/health')return;
  requests++;let ended=false;const finish=()=>{if(!ended){ended=true;requests--;}};response.once('finish',finish);response.once('close',finish);
 };
 subscribe('http.server.request.start',listener);
 return {close:()=>unsubscribe('http.server.request.start',listener),busy:async()=>{
  let jobs=0;
  try{
   await lstat(path.join(directory,'judu.sqlite'));
   const sqlite=/** @type {{DatabaseSync:new(file:string,options:{readOnly:boolean})=>import('./library.mjs').SqliteDatabase}} */(/** @type {unknown} */(process.getBuiltinModule('node:sqlite')));
   const db=new sqlite.DatabaseSync(path.join(directory,'judu.sqlite'),{readOnly:true});try{jobs=busyDatabase(db);}finally{db.close();}
  }catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
  return requests+jobs;
 }};
}
