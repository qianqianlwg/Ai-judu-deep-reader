import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "./db";
import { importUmdEdition } from "./umd-import";
import { makeUmdFixture } from "./umd-fixture";
import { readDerivedEpub, derivedRelativePath } from "./data-storage";
import { resolveConvertedEpub, verifyConvertedEpub } from "./converted-epub-artifact";
import { convertedPositionKey } from "./epub-position";
import { mapEpubDocument, rangeForEpubAnchor, selectionFromEpubRange } from "./epub-source-map";
let directory: string, db: ReturnType<typeof createDatabase>;
beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),"judu-umd-ui-"));vi.stubEnv("JUDU_DATA_DIR",directory);vi.stubGlobal("crypto",webcrypto);db=createDatabase();});
afterEach(async()=>{db.close();vi.unstubAllEnvs();vi.unstubAllGlobals();if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith("judu-umd-ui-"))throw new Error("清理越界");await rm(directory,{recursive:true,force:true});});
it.each(["upstream","literal"])("%s UMD真实转换/存储→派生身份校验→DOM Range逐字来源，不经过旧EPUB提取器",async kind=>{
 const input=kind==="upstream"?await readFile("src/lib/fixtures/umd/flyfish-book.umd"):makeUmdFixture({chapters:[{title:"同文标题",text:"同文标题\n字面量 &amp; &lt;script&gt; <公式>😀\n重复正文\n重复正文"},{title:"第二章",text:"第二章\n中文𠮷与最后一段。"}]});
 const book=await importUmdEdition({db,dataDir:directory},"sample.umd",input);
 const source=resolveConvertedEpub(book);expect(source.kind).toBe("ready");if(source.kind!=="ready")throw new Error("identity missing");
 const bytes=await readDerivedEpub({dataDir:directory,relativePath:derivedRelativePath(book.editionId),size:source.artifact.conversion.fileSize,fileHash:source.artifact.conversion.fileHash});
 await expect(verifyConvertedEpub(new Uint8Array(bytes).buffer,source.artifact)).resolves.toBeUndefined();
 const archive=await JSZip.loadAsync(bytes);let mapped=0;
 for(const chapter of book.chapters){
  const xml=await archive.file(chapter.sourceHref!)!.async("string");const dom=new JSDOM(xml,{contentType:"application/xhtml+xml"});
  try{
   const maps=mapEpubDocument(dom.window.document,chapter);expect(maps).toHaveLength(chapter.paragraphs.length);
   for(const paragraph of chapter.paragraphs){
    const range=rangeForEpubAnchor(maps,paragraph.id,0,paragraph.text.length);expect(range).not.toBeNull();
    const selection=selectionFromEpubRange(range!,maps);expect(selection?.paragraphId).toBe(paragraph.id);
    expect(selection?.text).toBe(paragraph.text.slice(selection?.startOffset,selection?.endOffset));
    expect(range?.toString().replace(/\s/gu,"")).toBe(paragraph.text.replace(/\s/gu,""));mapped++;
   }
   expect(dom.window.document.querySelector('script')).toBeNull();
  }finally{dom.window.close();}
 }
 expect(mapped).toBeGreaterThan(0);
 const second=await importUmdEdition({db,dataDir:directory},"same-source.umd",input);
 expect(second.edition.conversion.fileHash).toBe(book.edition.conversion.fileHash);
 expect(convertedPositionKey(second.editionId)).not.toBe(convertedPositionKey(book.editionId));
 const dom=new JSDOM(await archive.file(second.chapters[0].sourceHref!)!.async("string"),{contentType:"application/xhtml+xml"});
 try{expect(rangeForEpubAnchor(mapEpubDocument(dom.window.document,second.chapters[0]),book.chapters[0].paragraphs[0].id,0,1)).toBeNull();}finally{dom.window.close();}
});
