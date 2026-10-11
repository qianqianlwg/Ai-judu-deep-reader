type BookStorage=Pick<Storage,'length'|'key'|'getItem'|'removeItem'>;
export function clearDeletedBookStorage(storage:BookStorage,bookId:string,editionIds:readonly string[]):void{
 const exact=new Set(['judu:edition:'+bookId,'judu:resume-meta:'+bookId,'judu:guide-view:'+bookId,'judu:workspace-view:'+bookId,'judu:reading-preferences:'+bookId,'judu:thread:'+bookId]);
 for(const editionId of editionIds)for(const prefix of ['original-position','converted-position','pdf-position','cbz-position','reader-mode','reading-preferences','book-context-prefetch'])exact.add('judu:'+prefix+':'+editionId);
 const prefixes=['judu:thread:'+bookId+':','judu:position:'+bookId+':','judu:annotations:'+bookId+':'];
 if(storage.getItem('judu:active-book')===bookId)exact.add('judu:active-book');
 // WHY：先快照键，再逐项移除，避免索引移动漏删；仅匹配完整身份边界，不能用includes误删同名前缀的其他书或全局设置。
 const keys=Array.from({length:storage.length},(_,index)=>storage.key(index)).filter((key):key is string=>key!==null);
 for(const key of keys)if(exact.has(key)||prefixes.some(prefix=>key.startsWith(prefix)))storage.removeItem(key);
}
