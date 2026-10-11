import fs from 'node:fs/promises';import path from 'node:path';
import {removeStoredOriginalFile,removeDerivedEpub} from './data-storage';
import {validateDeletionFile,type BookDeletionFile} from './book-deletion-store';
export async function removeBookDeletionFile(file:BookDeletionFile,dataDir:string):Promise<void>{
 validateDeletionFile(file);
 if(file.kind==='original')return removeStoredOriginalFile(dataDir,file.path);
 if(file.kind==='derived')return removeDerivedEpub(dataDir,file.path);
 const root=await fs.realpath(dataDir),directory=path.join(root,'covers-v1'),target=path.join(root,file.path);
 // WHY：封面仅按已验证指纹单文件删除，绝不递归清目录、跟随链接或触碰正式书库以外的路径。
 if(path.dirname(target)!==directory)throw new Error('封面删除路径越界');
 try{if((await fs.lstat(directory)).isSymbolicLink()||await fs.realpath(directory)!==directory)throw new Error('封面缓存目录不安全');const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('封面缓存文件不安全');await fs.unlink(target);}
 catch(cause:unknown){if(!(cause instanceof Error&&'code'in cause&&cause.code==='ENOENT'))throw cause;}
}
