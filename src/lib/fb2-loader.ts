import {parseFb2Book} from './fb2-book';
import {createFb2FoliateBook} from './fb2-render';
import {initializeFoliate} from './epub-loader';
import {inspectZip,validateArchive} from './epub-security-zip';
import {fb2ArchiveFile,isCompressedFb2,isFb2Format} from './fb2-format';
import {FB2_XML_LIMIT} from './fb2-xml';
import type {FoliateBook} from './foliate-types';
export async function loadFb2(original:Blob,format:string):Promise<FoliateBook>{
 if(!isFb2Format(format))throw new Error("不支持的FB2容器格式");
 let bytes:Uint8Array;
 if(isCompressedFb2(format)){
  const records=await inspectZip(original,'fbz'),name=fb2ArchiveFile([...records.values()]);const bridge=await initializeFoliate(),archive=await bridge.openArchive(original);
  try{validateArchive(archive,records);const entry=archive.entries.find(entry=>entry.filename===name);if(!entry)throw new Error('FBZ正文条目不存在');bytes=await entry.read(FB2_XML_LIMIT);}finally{await archive.close();}
 }else{if(original.size>FB2_XML_LIMIT)throw new Error('FB2文件超过24MiB');bytes=new Uint8Array(await original.arrayBuffer());}
 const model=parseFb2Book(bytes);return createFb2FoliateBook(model);
}
