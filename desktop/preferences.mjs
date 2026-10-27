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
// WHY：localStorage按来源（含端口）隔离；每个profile首启选空闲端口，随后复用，不能每次重启丢失界面阅读状态。
/** @param {string} profile */
export async function readDesktopPort(profile){
 const file=path.join(profile,'desktop-port.json');
 try{
  /** @type {unknown} */const value=JSON.parse(await readFile(file,'utf8'));
  if(!value||typeof value!=='object'||!('port'in value)||typeof value.port!=='number'||!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('阅读端口配置损坏，请保留profile并检查desktop-port.json');
  return value.port;
 }catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 // WHY：升级旧客户端时从本机受限事件日志取最后一次来源，尽量保留既有浏览器偏好；不存在日志才首次选址。
 try{
  const lines=(await readFile(path.join(profile,'desktop-events.log'),'utf8')).trim().split('\n').reverse();
  for(const line of lines){/** @type {unknown} */const event=JSON.parse(line);if(event&&typeof event==='object'&&'event'in event&&event.event==='started'&&'port'in event&&typeof event.port==='number'&&Number.isInteger(event.port)&&event.port>=1024&&event.port<=65535)return event.port;}
 }catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 return undefined;
}
/** @param {string} profile @param {boolean} fresh */
export async function defaultLibraryDirectory(profile,fresh){
 const directory=path.join(profile,'library');
 if(fresh){try{await lstat(directory);return path.join(profile,'library-'+randomUUID());}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}}
 return directory;
}
