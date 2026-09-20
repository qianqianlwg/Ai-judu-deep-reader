import {createHash} from "node:crypto";
import {parseMobiSourceLocator} from "./mobi-source-bytes.mjs";
/** 尚未净化的包内布局快照：不得直接插入DOM、建立blob或作为可执行资源公开。 */
export type MobiLayoutResource = { id: string; mediaType: string; bytes: Uint8Array };
export type MobiLayoutPoint = {kind:'element';path:number[];tag:string;offset:0}|{kind:'text';path:number[];offset:number;textLength:number;textHash:string};
export type MobiLayoutTarget = {chapterId:string;htmlHash:string;locator:string;byteOffset:number;htmlOffset:number;point:MobiLayoutPoint};
export type MobiLayoutLink = { chapterId: string; href: string; target: MobiLayoutTarget | null; reason: "exact-source" | "external" | "unresolved" };
export type MobiLayoutSnapshot = {
  schema: "mobi-layout-untrusted-v3"; kind: "mobi" | "kf8"; sourceHash: string;
  title: string; authors: string[]; cover: string | null;
  chapters: { id: string; title: string; html: string; head: string; css: string[]; paragraphs: string[] }[];
  resources: MobiLayoutResource[];
  toc: { label: string; href: string; target: MobiLayoutTarget | null; depth: number }[];
  links: MobiLayoutLink[];
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const resourceId = (value: unknown): value is string => typeof value === "string" && value.length <= 512 && /^mobi-resource-v1\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|bmp|svg|css|xml|xhtml|html|mp4|mkv|webm|mp3|wav|ogg|ttf|otf|woff|woff2|eot|bin)$/u.exec(value)?.[0] === value;
function fail(): never { throw new Error("MOBI布局快照无效或超限"); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) fail();
  return value;
}
/** WHY：IPC数据并非可信HTML；父进程逐字段复核归属与预算，不把解析成功升级成安全渲染证明。 */
export function readMobiLayoutSnapshot(value: unknown): MobiLayoutSnapshot {
  const input = record(value, ["schema", "kind", "sourceHash", "title", "authors", "cover", "chapters", "resources", "toc", "links"]);
  if (input.schema !== "mobi-layout-untrusted-v3" || (input.kind !== "mobi" && input.kind !== "kf8") || typeof input.sourceHash !== "string" || input.sourceHash.length !== 64 || !/^[0-9a-f]{64}$/u.test(input.sourceHash)) fail();
  let chars = 0, paragraphs = 0, resourceBytes = 0;
  const string = (text: unknown, limit = 4096): string => { if (typeof text !== "string" || text.length > limit) fail(); chars += text.length; if (chars > 40_000_000) fail(); return text; };
  const array = (items: unknown, max: number): unknown[] => { if (!Array.isArray(items) || items.length > max || Object.keys(items).length !== items.length || Object.keys(items).some((key,index)=>key !== String(index))) fail(); return items; };
  const title = string(input.title), authors = array(input.authors, 256).map(author => string(author));
  const resourceIds = new Set<string>();
  // WHY：MIME仍只是类型提示，但角色必须与固定扩展名一致，不能让HTML伪装CSS或封面。
  const types: Record<string,string> = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',bmp:'image/bmp',svg:'image/svg+xml',css:'text/css',xml:'application/xml',xhtml:'application/xhtml+xml',html:'text/html',mp4:'video/mp4',mkv:'video/x-matroska',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2',eot:'application/vnd.ms-fontobject',bin:'application/octet-stream'};
  const rawResources = array(input.resources, 5000);
  // WHY：先核对累计字节预算再复制，不能为随后会被拒绝的大IPC消息逐项分配副本。
  for(const item of rawResources){if(!object(item)||!(item.bytes instanceof Uint8Array)||!item.bytes.length)fail();resourceBytes+=item.bytes.length;if(resourceBytes>100*1024*1024)fail();}
  const resources = rawResources.map(item => {
    const r = record(item, ["id", "mediaType", "bytes"]);
    if (!resourceId(r.id) || resourceIds.has(r.id) || !(r.bytes instanceof Uint8Array) || !r.bytes.length) fail();
    const mediaType = string(r.mediaType, 128); if (mediaType !== types[r.id.split(".").at(-1)!]) fail();
    resourceIds.add(r.id); return { id: r.id, mediaType, bytes: new Uint8Array(r.bytes) };
  });
  const cover = input.cover; if (cover !== null && (!resourceId(cover) || !resourceIds.has(cover) || !resources.find(resource=>resource.id===cover)?.mediaType.startsWith("image/"))) fail();
  const ids = new Set<string>();
  const chapters = array(input.chapters, 10_000).map(item => {
    const c = record(item, ["id", "title", "html", "head", "css", "paragraphs"]), id = string(c.id, 256);
    if (!id || ids.has(id)) fail(); ids.add(id);
    const css = array(c.css, 5000).map(item => { if (!resourceId(item) || !item.endsWith(".css") || !resourceIds.has(item)) fail(); return item; });
    const texts = array(c.paragraphs, 100_000).map(text => string(text, 20_000_000)); paragraphs += texts.length; if (paragraphs > 100_000) fail();
    return { id, title: string(c.title), html: string(c.html, 20_000_000), head: string(c.head, 20_000_000), css, paragraphs: texts };
  });
  if (!chapters.length) fail();
  const htmlHashes=new Map(chapters.map(chapter=>[chapter.id,createHash("sha256").update(chapter.html).digest("hex")]));
  const target = (value: unknown, href:string): MobiLayoutTarget | null => {
    if(value===null)return null;
    const t=record(value,['chapterId','htmlHash','locator','byteOffset','htmlOffset','point']);
    if(typeof t.chapterId!=='string'||!ids.has(t.chapterId)||typeof t.htmlHash!=='string'||t.htmlHash!==htmlHashes.get(t.chapterId)||typeof t.locator!=='string'||t.locator.length>256
      ||!Number.isSafeInteger(t.byteOffset)||Number(t.byteOffset)<0||Number(t.byteOffset)>20_000_000
      ||!Number.isSafeInteger(t.htmlOffset)||Number(t.htmlOffset)<0||Number(t.htmlOffset)>20_000_000)fail();
    const locator=parseMobiSourceLocator(t.locator);
    if(t.locator!==href||locator?.kind!==input.kind||Number(t.htmlOffset)>Number(t.byteOffset)||(locator?.kind==='mobi'&&Number(t.byteOffset)>locator.offset))fail();
    if(!object(t.point))fail();
    const p=record(t.point,t.point.kind==='element'?['kind','path','tag','offset']:['kind','path','offset','textLength','textHash']);
    const path=array(p.path,128).map(value=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>400000)fail();return value;});
    if(!path.length)fail();
    let point:MobiLayoutPoint;
    if(p.kind==='element'){if(typeof p.tag!=='string'||!/^[a-z][a-z0-9:-]*$/u.test(p.tag)||p.tag.length>128||p.offset!==0)fail();point={kind:'element',path,tag:p.tag,offset:0};}
    else{if(p.kind!=='text'||typeof p.offset!=='number'||!Number.isSafeInteger(p.offset)||p.offset<0||typeof p.textLength!=='number'||!Number.isSafeInteger(p.textLength)||p.textLength>20_000_000||p.textLength<p.offset||typeof p.textHash!=='string'||p.textHash.length!==64||!/^[0-9a-f]{64}$/u.test(p.textHash))fail();point={kind:'text',path,offset:p.offset,textLength:p.textLength,textHash:p.textHash};}
    return {chapterId:t.chapterId,htmlHash:t.htmlHash,locator:t.locator,byteOffset:Number(t.byteOffset),htmlOffset:Number(t.htmlOffset),point};
  };
  const toc = array(input.toc, 10_000).map(item => { const t = record(item, ["label", "href", "target", "depth"]);
    if (typeof t.depth !== "number" || !Number.isSafeInteger(t.depth) || t.depth < 0 || t.depth > 128) fail();
    return { label: string(t.label), href: string(t.href), target: target(t.target, String(t.href)), depth: t.depth };
  });
  const links = array(input.links, 20_000).map<MobiLayoutLink>(item => {
    const l = record(item, ["chapterId", "href", "target", "reason"]);
    if (typeof l.chapterId !== "string" || !ids.has(l.chapterId) || (l.reason !== "exact-source" && l.reason !== "external" && l.reason !== "unresolved")) fail();
    const dest = target(l.target,String(l.href)); if ((l.reason === "exact-source") !== (dest !== null)) fail();
    return { chapterId: l.chapterId, href: string(l.href), target: dest, reason: l.reason };
  });
  return { schema: input.schema, kind: input.kind, sourceHash: input.sourceHash, title, authors, cover, chapters, resources, toc, links };
}
