// @ts-check
import { spawn } from 'node:child_process';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { installSecretKey } from '../src/lib/desktop-secret-codec.mjs';
/** @param {string} nodePath @param {{operation:'prepare'|'copy';directory:string;source?:string}} request @param {Buffer} key */
export async function runLibraryOperation(nodePath,request,key){
 return await new Promise((resolve,reject)=>{
  const child=spawn(nodePath,[fileURLToPath(import.meta.url)],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',JUDU_DESKTOP_TOKEN:'library-migration'}});
  let done=false;let errorOutput='';
  child.stderr?.on('data',chunk=>{errorOutput=(errorOutput+String(chunk)).slice(-2048);});child.stdout?.resume();
  child.once('error',reject);
  child.on('message',message=>{
   if(!message||typeof message!=='object')return;
   if('error'in message){done=true;reject(new Error(String(message.error)));}
   else if('result'in message){done=true;resolve(message.result);}
  });
  child.once('exit',code=>{if(!done)reject(new Error('书库操作进程退出 '+code+': '+errorOutput));});
  child.send({...request,key:key.toString('base64')});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.once('message',async message=>{
  try{
   if(!message||typeof message!=='object'||!('key'in message)||typeof message.key!=='string'||!('directory'in message)||typeof message.directory!=='string')throw new Error('书库操作参数无效');
   installSecretKey(Buffer.from(message.key,'base64'));
   const {prepareLibrary,copyLibrary}=await import('./library.mjs');
   const result='operation'in message&&message.operation==='copy'&&'source'in message&&typeof message.source==='string'
    ?await copyLibrary(message.source,message.directory):await prepareLibrary(message.directory);
   process.send?.({result});
  }catch(error){process.send?.({error:error instanceof Error?error.message:'书库操作失败'});}
  finally{process.disconnect();}
 });
}
