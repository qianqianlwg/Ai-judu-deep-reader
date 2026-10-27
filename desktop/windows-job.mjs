// @ts-check
import {readFile,lstat}from'node:fs/promises';import path from'node:path';
import {spawn} from 'node:child_process';import {fileURLToPath}from'node:url';
/** @param {number} pid */
export async function guardWindowsProcess(pid){
 let executable=fileURLToPath(new URL('./JuduJobGuard.exe',import.meta.url));
 try{await lstat(executable);}catch(e){
  if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;
  const cached=JSON.parse(await readFile(new URL('../build/desktop-tools/guard-location.json',import.meta.url),'utf8'));
  const allowed=fileURLToPath(new URL('../build/desktop-tools/',import.meta.url));if(typeof cached.file!=='string'||!path.resolve(cached.file).startsWith(allowed))throw new Error('守护程序构建路径无效');executable=cached.file;
 }
 const child=spawn(executable,[String(pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let ready=false;let text='';let error='';
 const closed=new Promise(resolve=>child.once('exit',resolve));
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Windows进程保护启动超时')),15000);
   child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);if(!ready)reject(new Error('Windows进程保护启动失败 '+error));});
   child.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-1024);});
   child.stdout.on('data',chunk=>{text+=String(chunk);if(!ready&&text.includes('JUDU_JOB_READY')){ready=true;clearTimeout(timer);resolve(undefined);}});
  });
  return {close:async()=>{child.stdin.end();await closed;}};
 }catch(e){child.stdin.end();await closed;throw e;}
}
