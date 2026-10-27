// @ts-check
import {readFile,writeFile,rename,mkdir,unlink,lstat}from'node:fs/promises';import path from'node:path';import {randomUUID}from'node:crypto';
/** @param {string} file @param {unknown} value */
export async function atomicJson(file,value){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,file);}
/** @param {string} profile */
export async function readLibraryChoice(profile){
 try{/** @type {unknown} */const value=JSON.parse(await readFile(path.join(profile,'library-choice.json'),'utf8'));
  if(!value||typeof value!=='object'||!('directory'in value)||typeof value.directory!=='string'||!path.isAbsolute(value.directory))throw new Error('书库选择配置损坏，请保留配置并重新选择');return value.directory;
 }catch(e){if(e instanceof Error&&'code'in e&&e.code==='ENOENT')return undefined;throw e;}
}
/** @param {string} directory */
export async function lockLibrary(directory){
 await mkdir(directory,{recursive:true});const file=path.join(directory,'desktop-library.lock');const id=randomUUID();
 for(let attempt=0;attempt<2;attempt++){
  try{await writeFile(file,JSON.stringify({pid:process.pid,id}),{flag:'wx',mode:0o600});return async()=>{
   const current=JSON.parse(await readFile(file,'utf8'));if(current.id!==id)throw new Error('书库锁归属已改变');await unlink(file);
  };}catch(e){
   if(!(e instanceof Error&&'code'in e&&e.code==='EEXIST'))throw e;
   if((await lstat(file)).isSymbolicLink())throw new Error('书库锁不能是链接');
   const current=JSON.parse(await readFile(file,'utf8'));if(!Number.isSafeInteger(current.pid)||current.pid<1)throw new Error('书库锁损坏，请保留现场');
   try{process.kill(current.pid,0);throw new Error('书库正在被另一客户端使用');}
   catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;}
   await unlink(file);
  }
 }throw new Error('无法取得书库锁');
}
