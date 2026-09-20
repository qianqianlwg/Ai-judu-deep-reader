import{createRequire}from'node:module';import{readFile}from'node:fs/promises';import{describe,it,expect}from'vitest';
import{documentAdapterFor}from'./document-adapter';import{pdfSafeText}from'./pdf-text';import{resolvePdfDestinationPage}from'./pdf-links';import{mapPdfDocument,type PdfTextPage}from'./pdf-source-map';
const file=process.env.PDF_FIXTURE_PATH;
describe.skipIf(!file)('用户论文PDF本地原版索引回归',()=>{
 it('50页页码/文字/UTF16保存后不截断，全部文字项可精确对应',async()=>{
  const buffer=await readFile(file!),extracted=await documentAdapterFor('.pdf')!.extract({fileName:'thesis.pdf',extension:'.pdf',buffer,tempPath:''});
  type MemoryDatabase={exec(sql:string):void;close():void;prepare(sql:string):{run(...values:(string|number)[]):unknown;all():{id:number;text:string}[]}};
  const sqlite=(process as unknown as {getBuiltinModule(name:string):{DatabaseSync:new(path:string)=>MemoryDatabase}}).getBuiltinModule('node:sqlite');
  // WHY：只用同步内存数据库核验真实SQLite文本边界，不访问正式书库。
  const db=new sqlite.DatabaseSync(':memory:');const require=createRequire(import.meta.url);const pdf=require('pdfjs-dist/legacy/build/pdf.mjs') as typeof import('pdfjs-dist');
  const task=pdf.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false});
  try{
   db.exec('CREATE TABLE texts (id INTEGER PRIMARY KEY,text TEXT)');const insert=db.prepare('INSERT INTO texts(id,text)VALUES(?,?)');const paragraphs=extracted.chapters.map((chapter,index)=>{const text=chapter.paragraphs.join('');insert.run(index,text);return {id:'p'+index,text};});
   const restored=db.prepare('SELECT id,text FROM texts ORDER BY id').all();expect(restored.map(row=>row.text)).toEqual(paragraphs.map(p=>p.text));expect(paragraphs.every(p=>!p.text.includes('\0'))).toBe(true);
   const document=await task.promise,pages:PdfTextPage[]=[];
   for(let number=1;number<=document.numPages;number++){const page=await document.getPage(number);try{const content=await page.getTextContent(),viewport=page.getViewport({scale:1});pages.push({pageNumber:number,...(page.ref?{reference:page.ref}:{}),width:viewport.width,height:viewport.height,rotation:page.rotate,mapped:false,runs:[],items:content.items.flatMap(item=>'str'in item?[{...item,str:pdfSafeText(item.str)}]:[])});}finally{page.cleanup();}}
   const book={id:'book',editionId:'edition',title:extracted.title,author:extracted.author,chapters:extracted.chapters.map((chapter,index)=>({id:'c'+index,title:chapter.title,sourceHref:chapter.sourceHref,paragraphs:chapter.paragraphs.length?[paragraphs[index]]:[]}))};
   const mapped=mapPdfDocument(pages,book);expect(document.numPages).toBe(50);expect(mapped.complete).toBe(true);expect(mapped.pages).toHaveLength(50);expect(mapped.pages.every(page=>page.runs.length>0)).toBe(true);
   const toc=await document.getPage(3);try{const annotations:unknown[]=await toc.getAnnotations({intent:'display'});const link=annotations.find(item=>item&&typeof item==='object'&&'dest'in item);expect(link).toBeTruthy();if(link&&typeof link==='object'&&'dest'in link){await expect(resolvePdfDestinationPage(document,link.dest,mapped.pages)).rejects.toThrow();const valid=mapped.pages[5];expect(await resolvePdfDestinationPage(document,[valid.reference],mapped.pages)).toBe(6);}}finally{toc.cleanup();}
  }finally{await task.destroy();db.close();}
 },20000);
});
