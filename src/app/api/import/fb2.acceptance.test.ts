import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import JSZip from 'jszip';
import {NextRequest} from 'next/server';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {createDatabase as CreateDatabase} from '@/lib/db';
const state=vi.hoisted(()=>({db:undefined as ReturnType<typeof CreateDatabase>|undefined}));
vi.mock('@/lib/db',async original=>{const actual=await original<typeof import('@/lib/db')>();return {...actual,getDb:()=>{if(!state.db)throw new Error('测试数据库未初始化');return state.db;}};});
import {createDatabase} from '@/lib/db';import {readBookResponse} from '@/lib/library';import {POST} from './route';
import {GET as original} from '../books/[bookId]/original/route';import {GET as book} from '../books/[bookId]/route';
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'judu-fb2-test-'));vi.stubEnv('JUDU_DATA_DIR',directory);state.db=createDatabase();vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{state.db?.close();state.db=undefined;vi.restoreAllMocks();vi.unstubAllEnvs();const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('judu-fb2-test-'))throw new Error('不安全测试清理');await rm(resolved,{recursive:true,force:true});});
const request=(bytes:Uint8Array,name:string)=>{const form=new FormData();form.set('file',new File([new Uint8Array(bytes)],name));return new NextRequest('http://localhost/api/import',{method:'POST',body:form});};
it.each(['source.fb2','source.FBZ','source.fb2.zip'])('%s导入→持久化→版本绑定原件下载→来源读取闭环',async name=>{
 const xml=await readFile('src/lib/fixtures/reader.fb2');let bytes:Buffer=xml;if(!name.endsWith('.fb2')){const zip=new JSZip();zip.file('book.fb2',xml);bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
 const response=await POST(request(bytes,name));const raw:unknown=await response.json();expect(response.status,JSON.stringify(raw)).toBe(200);
 const result=raw as {id:string;editionId:string;originalHash:string};const parsed=readBookResponse(raw,result.id,result.editionId);expect(parsed.chapters).toHaveLength(3);expect(parsed.chapters[0].sourceHref).toBe('fb2-v1/section-0.xhtml');expect(parsed.edition?.fileType).toBe(name.endsWith('.fb2')?'.fb2':'.fbz');expect(result.originalHash).toBe(createHash('sha256').update(bytes).digest('hex'));
 state.db!.close();state.db=createDatabase();const downloaded=await original(new Request('http://localhost/original?editionId='+result.editionId),{params:Promise.resolve({bookId:result.id})});expect(downloaded.status).toBe(200);expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
 const restored=await book(new Request('http://localhost/book?editionId='+result.editionId),{params:Promise.resolve({bookId:result.id})});const contents=readBookResponse(await restored.json(),result.id,result.editionId);expect(contents.chapters).toEqual(parsed.chapters);
 const foreign=await original(new Request('http://localhost/original?editionId='+result.editionId),{params:Promise.resolve({bookId:'other-book'})});expect(foreign.status).toBe(404);
});
it('坏FB2和有歧义的FBZ不会生成书籍或残留原件',async()=>{
 const xml=await readFile('src/lib/fixtures/reader.fb2'),zip=new JSZip();zip.file('a.fb2',xml);zip.file('b.fb2',xml);
 for(const [bytes,name]of [[Buffer.from('<FictionBook><body>broken</body></FictionBook>'),'bad.fb2'],[await zip.generateAsync({type:'nodebuffer'}),'bad.fbz']] as const){const response=await POST(request(bytes,name));expect(response.status).toBe(422);expect(await response.json()).toHaveProperty('error');}
 expect(state.db!.prepare('SELECT COUNT(*) AS n FROM books').get()).toEqual({n:0});expect((await readdir(directory)).includes('originals')).toBe(false);
});

it('纯图FB2保留原件与空文字章节，不伪造可句读段落',async()=>{
 const sample=await readFile('src/lib/fixtures/reader.fb2','utf8'),binary=sample.match(/<binary[\s\S]*?<\/binary>/u)?.[0];expect(binary).toBeTruthy();const xml='<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><body><section><image l:href="#pixel"/></section></body>'+binary+'</FictionBook>';
 const response=await POST(request(Buffer.from(xml),'image-only.fb2'));expect(response.status).toBe(200);const raw=await response.json() as {id:string;editionId:string};const parsed=readBookResponse(raw,raw.id,raw.editionId);expect(parsed.edition?.hasOriginalFile).toBe(true);expect(parsed.chapters).toHaveLength(1);expect(parsed.chapters[0].paragraphs).toEqual([]);expect(state.db!.prepare('SELECT COUNT(*) AS n FROM paragraphs').get()).toEqual({n:0});
});
