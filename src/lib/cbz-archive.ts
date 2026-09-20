import {inspectZip} from './epub-security-zip';
import {readValidatedZipEntry,visitValidatedZip} from './epub-import-security';
import {cbzPages,type CbzPage} from './cbz-manifest';
import {validateCbzImage,type CbzImageInfo} from './cbz-image';
async function manifest(bytes:Buffer):Promise<CbzPage[]>{const entries=await inspectZip(new Blob([new Uint8Array(bytes)]),'cbz');return cbzPages([...entries.values()]);}
export async function inspectCbzArchive(bytes:Buffer):Promise<CbzPage[]>{
 const pages=await manifest(bytes),names=new Set(pages.map(page=>page.name));
 await visitValidatedZip(bytes,false,async(name,content)=>{if(names.has(name))await validateCbzImage(name,content);});return pages;
}
export async function readCbzPage(bytes:Buffer,pageNumber:number,expectedHref:string):Promise<{bytes:Buffer;info:CbzImageInfo}>{
 const pages=await manifest(bytes);if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>pages.length)throw new Error('CBZ页码无效');const page=pages[pageNumber-1];
 if(page.sourceHref!==expectedHref)throw new Error('CBZ页来源与版本索引不一致');const content=await readValidatedZipEntry(bytes,page.name),info=await validateCbzImage(page.name,content,false);return {bytes:content,info};
}
