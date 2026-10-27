// @ts-check
import {dialog}from'electron';import path from'node:path';import {mkdir,writeFile}from'node:fs/promises';
import {validateDataDirectory}from'./locations.mjs';
import {randomBytes}from'node:crypto';import{runLibraryOperation}from'./library-process.mjs';
/** @param {{nodePath:string;profile:string;encrypt:(value:string)=>Promise<Buffer>;validate:(directory:string)=>void}} options */
export async function chooseNewLibrary(options){
 const action=await dialog.showMessageBox({type:'question',title:'书库位置',message:'新建书库，或复制已有 Web 版书库',detail:'复制不会删除原书库。请先关闭旧版并确认没有生成任务。客户端书库可用“切换书库”直接接入。',buttons:['使用默认新书库','复制旧 Web 书库','在其他位置新建','取消'],cancelId:3,defaultId:0});
 if(action.response===3)return undefined;
 if(action.response===0)return path.join(options.profile,'library');
 let source;
 if(action.response===1){const result=await dialog.showOpenDialog({title:'选择包含 judu.sqlite 的旧 data 目录',properties:['openDirectory']});source=result.filePaths[0];if(!source)return undefined;}
 const target=await dialog.showOpenDialog({title:'选择存放新书库的父目录（自动创建独立子目录）',properties:['openDirectory','createDirectory']});if(!target.filePaths[0])return undefined;
 const directory=path.join(target.filePaths[0],'句读书库-'+Date.now());
 options.validate(directory);await validateDataDirectory(directory);
 if(source){
  const key=randomBytes(32);await runLibraryOperation(options.nodePath,{operation:'copy',directory,source},key);
  await writeFile(path.join(directory,'desktop-vault.bin'),await options.encrypt(key.toString('base64')),{flag:'wx',mode:0o600});
 }else await mkdir(directory);
 return directory;
}
