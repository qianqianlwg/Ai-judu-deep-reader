// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpubFile } from "./epub-parser";
import { mapEpubDocument, rangeForEpubAnchor, selectionFromEpubRange } from "./epub-source-map";
import { capReadingSelection, selectionMatchesParagraphs, selectionParts } from "./reader-selection";
import { countReadingCharacters } from "./reading-detail";
const directory=process.env.EPUB_FIXTURE_DIR;
// WHY：用户样本仅本地读取，按已提供文件哈希识别，不把书籍加入仓库或发送模型。
describe.skipIf(!directory)("截图对应真实 EPUB 多段选区回归",()=>{
 it("行政交界地区正文跨四段，映射完整后按1000字限制而不是单段拒绝",async()=>{
  let input: {file:string;buffer:Buffer}|undefined;
  for(const name of await readdir(directory!)){
   if(!name.endsWith('.epub'))continue;
   const file=path.join(directory!,name),buffer=await readFile(file);
   if(createHash('sha256').update(buffer).digest('hex')==='20b854d3fcc088a16c01d6f1998325056b8ea78734e83be46c559ed27a0a070a'){input={file,buffer};break;}
  }
  expect(input,'必须提供用户截图对应样本，不能把其他书冒充验收').toBeDefined();
  const parsed=await parseEpubFile(input!.file),zip=await JSZip.loadAsync(input!.buffer);
  const source=parsed.chapters.find(chapter=>chapter.paragraphs.some(text=>text.includes('我国经济中有个现象')))!
  expect(source).toBeDefined();
  const chapter={id:'real-chapter',title:source.title,paragraphs:source.paragraphs.map((text,index)=>({id:'p'+index,text}))};
  const file=zip.file(decodeURIComponent(source.sourceHref));expect(file).not.toBeNull();
  const doc=new DOMParser().parseFromString(await file!.async('string'),'application/xhtml+xml');
  const maps=mapEpubDocument(doc,chapter),first=chapter.paragraphs.findIndex(p=>p.text.includes('我国经济中有个现象'));
  const start=rangeForEpubAnchor(maps,'p'+first,0,chapter.paragraphs[first].text.length)!;
  const last=rangeForEpubAnchor(maps,'p'+(first+3),0,chapter.paragraphs[first+3].text.length)!;
  expect(start).not.toBeNull();expect(last).not.toBeNull();start.setEnd(last.endContainer,last.endOffset);
  const selected=selectionFromEpubRange(start,maps)!;expect(selected).not.toBeNull();expect(selectionParts(selected)).toHaveLength(4);
  expect(selectionMatchesParagraphs(selected,chapter.paragraphs)).toBe(true);
  const limited=capReadingSelection(selected);expect(countReadingCharacters(limited.text)).toBeLessThanOrEqual(1000);expect(selectionMatchesParagraphs(limited,chapter.paragraphs)).toBe(true);
  expect(selectionParts(limited).length).toBeGreaterThan(1);
 });
});
