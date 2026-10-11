import {BookDeletionError,prepareBookDeletion,finishBookDeletion,coverSharedWithOtherBook,type BookDeletionFile} from './book-deletion-store';
import type {ShelfStore} from './book-shelf';
type Dependencies={db:ShelfStore;inFlight:Set<string>;removeFile:(file:BookDeletionFile)=>Promise<void>};
export async function deleteArchivedBook({db,inFlight,removeFile}:Dependencies,bookId:string):Promise<{bookId:string;deleted:true;editionIds:string[]}>{
 if(inFlight.has(bookId))throw new BookDeletionError(409,'本书正在永久删除，请等待当前操作完成');
 inFlight.add(bookId);let started=false;
 try{const plan=prepareBookDeletion(db,bookId);started=true;
  for(const file of plan.files){if(file.kind==='cover'&&coverSharedWithOtherBook(db,bookId,file.hash))continue;await removeFile(file);}
  finishBookDeletion(db,bookId);return {bookId,deleted:true,editionIds:plan.editionIds};
 }catch(cause:unknown){if(!started)throw cause;console.error('书籍永久删除未完成',cause);throw new BookDeletionError(cause instanceof BookDeletionError?cause.status:500,'永久删除尚未完成，可能已有部分文件删除；请重试永久删除，不能恢复上架。');}
 finally{inFlight.delete(bookId);}
}
