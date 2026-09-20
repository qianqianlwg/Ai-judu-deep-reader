import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {createDatabase as CreateDatabase} from '@/lib/db';
const state=vi.hoisted(()=>({db:undefined as ReturnType<typeof CreateDatabase>|undefined}));
vi.mock('@/lib/db',async original=>({...await original<typeof import('@/lib/db')>(),getDb:()=>{if(!state.db)throw new Error('未初始化');return state.db;}}));
import {createDatabase} from '@/lib/db';
import {storeOriginalFile} from '@/lib/data-storage';
import {makeMobiFixture} from '@/lib/mobi-fixture';
import {GET} from './route';
let directory:string,stored:Awaited<ReturnType<typeof storeOriginalFile>>;
const get=(bookId='book-a',query='?editionId=edition-a')=>GET(new Request('http://localhost/api/books/ignored/mobi-layout'+query),{params:Promise.resolve({bookId})});
beforeEach(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'judu-mobi-route-'));vi.stubEnv('JUDU_DATA_DIR',directory);state.db=createDatabase();vi.spyOn(console,'error').mockImplementation(()=>{});
 stored=await storeOriginalFile({dataDir:directory,editionId:'edition-a',extension:'.mobi',buffer:makeMobiFixture()});
 state.db.exec("INSERT INTO books VALUES ('book-a','a','author','now'),('book-b','b','author','now');");
 const insert=state.db.prepare('INSERT INTO editions (id,book_id,file_name,file_type,file_hash,original_file_path,original_file_size,original_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
 insert.run('edition-a','book-a','a.mobi','.mobi','legacy',stored.relativePath,stored.size,stored.originalHash,'now');
 insert.run('other','book-b','b.mobi','.mobi','legacy',stored.relativePath,stored.size,stored.originalHash,'now');
});
afterEach(async()=>{state.db?.close();state.db=undefined;vi.restoreAllMocks();vi.unstubAllEnvs();const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('judu-mobi-route-'))throw new Error('清理路径越界');await fs.rm(resolved,{recursive:true,force:true});});
it('真实MOBI布局API返回受控JSON而非untrusted/原文件路径',async()=>{
 const response=await get();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-type')).toContain('application/json');
 const body=await response.json();expect(body).toMatchObject({schema:'mobi-publication-v1',sourceHash:stored.originalHash});expect(body.chapters).toHaveLength(2);expect(JSON.stringify(body)).not.toContain(directory);expect(JSON.stringify(body)).not.toContain('untrusted');expect((await get()).status).toBe(200);
},20000);
it('拒绝跨书/跨版本和重复参数，不猜版本',async()=>{expect((await get('book-b')).status).toBe(404);expect((await get('book-a','?editionId=edition-a&editionId=other')).status).toBe(400);expect((await get('book-a','?editionId=edition-a&x=y')).status).toBe(400);expect((await get('book-a','')).status).toBe(400);expect((await get('book-b','?editionId=other')).status).toBe(409);});
it('不支持格式或旧版本没有原件时有明确JSON错误',async()=>{
 state.db!.exec("UPDATE editions SET file_type='.pdf' WHERE id='edition-a'");expect((await get()).status).toBe(415);state.db!.exec("UPDATE editions SET file_type='.mobi',original_file_path='' WHERE id='edition-a'");expect(await(await get()).json()).toMatchObject({code:'ORIGINAL_NOT_AVAILABLE'});
});
it('命中内存缓存也要验证不可变原件；删除或篡改不能返回过期成功',async()=>{
 expect((await get()).status).toBe(200);await fs.chmod(stored.absolutePath,0o600);await fs.writeFile(stored.absolutePath,Buffer.alloc(stored.size));const bad=await get();expect(bad.status).toBe(409);expect(await bad.json()).toHaveProperty('error');await fs.rm(stored.absolutePath);expect((await get()).status).toBe(404);
},20000);
it('布局失败保持JSON，并不泄露路径',async()=>{
 const bytes=Buffer.from('bad mobi');await fs.chmod(stored.absolutePath,0o600);await fs.writeFile(stored.absolutePath,bytes);const {createHash}=await import('node:crypto');state.db!.prepare('UPDATE editions SET original_file_size=?,original_hash=? WHERE id=?').run(bytes.length,createHash('sha256').update(bytes).digest('hex'),'edition-a');
 const response=await get();expect(response.status).toBe(422);const body=await response.json();expect(body.code).toBe('MOBI_LAYOUT_FAILED');expect(JSON.stringify(body)).not.toContain(directory);
});
