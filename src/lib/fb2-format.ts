export const isFb2Format=(format:string):boolean=>['fb2','fbz','fb2.zip'].includes(format.replace(/^\./u,'').toLowerCase());
export const isCompressedFb2=(format:string):boolean=>['fbz','fb2.zip'].includes(format.replace(/^\./u,'').toLowerCase());
export function fb2ArchiveFile(entries:readonly {name:string;directory:boolean}[]):string{
 const files=entries.filter(entry=>!entry.directory);if(files.length!==1||!files[0].name.toLowerCase().endsWith('.fb2'))throw new Error('FBZ必须只包含一个FB2文件（可含目录），不猜多个文档中的正文');return files[0].name;
}
