// @ts-check
/** @typedef {{close():void;exec(sql:string):void;prepare(sql:string):{get(...args:unknown[]):Record<string,unknown>|undefined;all(...args:unknown[]):Record<string,unknown>[];run(...args:unknown[]):{changes:number|bigint}}}} SqliteDatabase */
// WHY：应用仍兼容Node20类型声明，但桌面运行时明确固定Node24的内建SQLite；不加载Electron原生ABI。
const {DatabaseSync,backup}=/** @type {{DatabaseSync:new(file:string,options?:{readOnly:boolean})=>SqliteDatabase;backup:(db:SqliteDatabase,file:string)=>Promise<number>}} */(/** @type {unknown} */(process.getBuiltinModule('node:sqlite')));
import { readFile,writeFile,rename,mkdir,readdir,lstat,copyFile,realpath,rm } from 'node:fs/promises';
import{createReadStream}from'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicJson }from'./preferences.mjs';
import { isWithin,validateDataDirectory } from './locations.mjs';
import { sealSecret,openSecret,SECRET_PREFIX } from '../src/lib/desktop-secret-codec.mjs';
export const LIBRARY_VERSION=1;
/** @param {string} file */
async function optionalJson(file){try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('书库配置必须是普通文件');return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e instanceof Error&&'code'in e&&e.code==='ENOENT')return undefined;throw e;}}
/** @param {string} directory */
export async function checkLibrary(directory){
 const marker=await optionalJson(path.join(directory,'desktop-library.json'));
 if(marker!==undefined && (!marker||typeof marker!=='object'||Array.isArray(marker)||marker.version!==LIBRARY_VERSION||marker.secretVersion!==1))throw new Error('书库来自不兼容的客户端版本，请使用对应版本或完整备份');
 return marker;
}
/** @param {SqliteDatabase} db @param {string} name */
function table(db,name){return Boolean(db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?').get(name));}
/** @param {SqliteDatabase} db */
export function busyDatabase(db){
 let count=0;
 for(const [name,condition] of [['chat_messages',"status='streaming'"],['guide_sources',"status IN ('pending','processing')"],['embedding_index_jobs',"status IN ('running','pausing')"]]){
  if(table(db,name)) count+=Number(db.prepare(`SELECT count(*) AS n FROM ${name} WHERE ${condition}`).get()?.n??0);
 }return count;
}
/** @param {string} directory */
export async function prepareLibrary(directory){
 await checkLibrary(directory);
 const file=path.join(directory,'judu.sqlite');
 let db;
 let recovered=0;
 try{
  const databaseStat=await lstat(file);if(databaseStat.isSymbolicLink()||!databaseStat.isFile())throw new Error('数据库必须是普通文件');
  // WHY：事务/启动修复需要同步 SQLite 原子语义；文件迁移仍使用异步 API。
  db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON');
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)>1)throw new Error('数据库版本高于当前客户端支持版本');
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new Error('书库完整性检查失败，请恢复备份');
  let changed=false;
  if(table(db,'ai_provider_configs')){
   for(const row of db.prepare('SELECT id,api_key FROM ai_provider_configs').all()){
    if(typeof row.api_key!=='string')throw new Error('凭据格式无效');
    if(row.api_key.startsWith(SECRET_PREFIX)){openSecret(row.api_key);continue;}
    if(row.api_key){db.prepare('UPDATE ai_provider_configs SET api_key=? WHERE id=?').run(sealSecret(row.api_key),row.id);changed=true;}
   }
  }
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [name,sql] of [
    ['chat_messages',"UPDATE chat_messages SET status='error' WHERE status='streaming'"],
    ['guide_sources',"UPDATE guide_sources SET status='failed',lease_token=NULL,lease_until=0,error='客户端中断；请明确重试，不自动调用模型' WHERE status IN ('pending','processing')"],
    ['embedding_index_jobs',"UPDATE embedding_index_jobs SET status='paused',error='客户端中断，请手动继续' WHERE status IN ('running','pausing')"],
    ['embedding_build_leases','DELETE FROM embedding_build_leases']
   ])if(table(db,name))recovered+=Number(db.prepare(sql).run().changes);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  // WHY：只修复客户端副本；清掉SQLite空闲页/WAL中的旧明文，绝不VACUUM原Web书库。
  if(changed){db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');}
 }catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
 finally{db?.close();}
 const speech=await optionalJson(path.join(directory,'speech-settings.json'));
 if(speech&&typeof speech.apiKey==='string'&&speech.apiKey){
  if(speech.apiKey.startsWith(SECRET_PREFIX))openSecret(speech.apiKey);
  else {speech.apiKey=sealSecret(speech.apiKey);await atomicJson(path.join(directory,'speech-settings.json'),speech);}
 }
 await atomicJson(path.join(directory,'desktop-library.json'),{version:1,secretVersion:1});
 if(recovered)await writeFile(path.join(directory,'desktop-recovery.json'),JSON.stringify({at:new Date().toISOString(),recovered,automaticModelRetry:false}));
 return {recovered};
}
/** @param {string} file */
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
/** @param {string} source @param {string} destination */
export async function copyLibrary(source,destination){
 source=await realpath(source);destination=path.resolve(destination);
 if(isWithin(source,destination)||isWithin(destination,source))throw new Error('新书库不能嵌套或覆盖源书库');
 await checkLibrary(source);await validateDataDirectory(destination);
 if(await optionalJson(path.join(source,'desktop-library.json')))throw new Error('客户端书库请选择切换书库');
 const sourceFile=path.join(source,'judu.sqlite');const sourceStat=await lstat(sourceFile);if(sourceStat.isSymbolicLink()||!sourceStat.isFile())throw new Error('源数据库必须是普通文件');
 const db=new DatabaseSync(sourceFile,{readOnly:true});
 const staging=destination+'.partial-'+randomUUID();await mkdir(staging,{recursive:false});
 /** @type {{path:string;sha256:string}[]} */ const files=[];
 try{
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)>1)throw new Error('源数据库版本不兼容');
  for(const name of ['books','editions','chapters','paragraphs'])if(!table(db,name))throw new Error('源数据库不是完整的句读书库，缺少 '+name);
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw new Error('源数据库完整性检查失败');
  if(busyDatabase(db))throw new Error('源书库仍有生成任务，请停止源程序并处理任务后重试');
  const version=db.prepare('PRAGMA data_version').get()?.data_version;
  await backup(db,path.join(staging,'judu.sqlite'));
  /** @param {string} relative */
  async function walk(relative){
   for(const entry of await readdir(path.join(source,relative),{withFileTypes:true})){
    const rel=path.join(relative,entry.name);const src=path.join(source,rel);const stat=await lstat(src);
    if(stat.isSymbolicLink())throw new Error('源书库包含链接，拒绝复制');
    if(!relative&&(/^judu\.sqlite(?:-|$)/.test(entry.name)||entry.name.startsWith('desktop-')))continue;
    if(stat.isDirectory()){await mkdir(path.join(staging,rel));await walk(rel);}
    else if(stat.isFile()){
     const before=await digest(src);await copyFile(src,path.join(staging,rel));
     if(before!==await digest(src)||before!==await digest(path.join(staging,rel)))throw new Error('复制期间源文件发生变化');
     files.push({path:rel,sha256:before});
    }else throw new Error('源书库存在非常规文件');
   }
  }await walk('');
  if(version!==db.prepare('PRAGMA data_version').get()?.data_version||busyDatabase(db))throw new Error('复制期间源数据库发生变化，请关闭源程序后重试');
  // WHY：仅首次迁移Web书库；客户端加密备份应整体复制并保留vault，不能错用新密钥。
  if(await optionalJson(path.join(source,'desktop-library.json')))throw new Error('客户端书库请选择“切换书库”，不要按旧Web书库导入');
  await prepareLibrary(staging);
  await writeFile(path.join(staging,'desktop-import-audit.json'),JSON.stringify({at:new Date().toISOString(),sourcePreserved:true,files}));
  await rename(staging,destination);
  return {directory:destination,files:files.length};
 }catch(error){
  // WHY：失败副本可能仍有旧明文凭据，必须清理，仅保留失败事件；源目录绝不进入删除路径。
  if(path.dirname(staging)!==path.dirname(destination)||!path.basename(staging).startsWith(path.basename(destination)+'.partial-')||isWithin(staging,source))throw new Error('迁移清理路径越界');
  await rm(staging,{recursive:true,force:true});
  throw new Error('书库复制失败，源书库未修改；未发布副本已清理。'+(error instanceof Error?error.message:''),{cause:error});
 }finally{db.close();}
}
