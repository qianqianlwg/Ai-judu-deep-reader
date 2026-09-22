import {mkdtemp,rm,readFile} from "node:fs/promises";
import os from "node:os";import path from "node:path";import JSZip from "jszip";import sharp from "sharp";
import {it,expect,vi} from "vitest";import {renderBookCover,cachedBookCover} from "./book-cover";
it("从真实 EPUB 容器读取封面并栅格化，不返回可执行文档",async()=>{
 const zip=new JSZip();zip.file("mimetype","application/epub+zip");zip.file("META-INF/container.xml",'<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 zip.file("OPS/book.opf",'<package version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">书</dc:title><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="cover.png" media-type="image/png"/></manifest><spine/></package>');
 zip.file("OPS/cover.png",await sharp({create:{width:120,height:160,channels:3,background:"#abcdef"}}).png().toBuffer());
 const image=await renderBookCover(await zip.generateAsync({type:"nodebuffer"}),".epub");expect(image).not.toBeNull();const metadata=await sharp(image!).metadata();expect(metadata.format).toBe("webp");expect(metadata.width).toBe(120);
});
it("内容哈希缓存避免重复渲染且拒绝非法路径",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"judu-covers-test-"));
 try{const render=vi.fn(async()=>Buffer.from("test-image")),hash="a".repeat(64);await Promise.all([cachedBookCover(hash,render,directory),cachedBookCover(hash,render,directory)]);await cachedBookCover(hash,render,directory);expect(render).toHaveBeenCalledOnce();expect(await readFile(path.join(directory,"covers-v1",hash+".webp"),"utf8")).toBe("test-image");await expect(cachedBookCover("../bad",render,directory)).rejects.toThrow();}
 finally{if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith("judu-covers-test-"))throw new Error("测试目录越界");await rm(directory,{recursive:true,force:true});}
});
it("真实 PDF 首页可生成有界 WebP",async()=>{
 const stream="0.2 0.4 0.6 rg 20 20 160 240 re f";const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];
 let pdf="%PDF-1.4\n";const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(index+1)+" 0 obj\n"+object+"\nendobj\n";});const start=Buffer.byteLength(pdf);pdf+="xref\n0 5\n0000000000 65535 f \n"+offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF";
 const image=await renderBookCover(Buffer.from(pdf),".pdf");const metadata=await sharp(image!).metadata();expect(metadata.format).toBe("webp");expect(metadata.width).toBeLessThanOrEqual(320);expect(metadata.height).toBeLessThanOrEqual(440);
});
