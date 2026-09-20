import {inspectZip} from './epub-security-zip';
import {visitValidatedZip} from './epub-import-security';
import {fb2ArchiveFile} from './fb2-format';
export async function readFb2Archive(bytes:Buffer):Promise<Uint8Array>{
 // WHY：FBZ复用EPUB结构/CRC/有界解压防线，但不伪造EPUB的mimetype；前后端采用相同的文件选择规则。
 const records=await inspectZip(new Blob([new Uint8Array(bytes)]),'fbz'),name=fb2ArchiveFile([...records.values()]);let result:Uint8Array|undefined;
 await visitValidatedZip(bytes,false,(path,content)=>{if(path===name)result=new Uint8Array(content);});if(!result)throw new Error('FBZ未读取到正文');return result;
}
