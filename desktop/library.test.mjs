import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {DatabaseSync}from'node:sqlite';
import {copyLibrary,prepareLibrary,checkLibrary,busyDatabase}from'./library.mjs';import {runLibraryOperation}from'./library-process.mjs';
import {installSecretKey,openSecret}from'../src/lib/desktop-secret-codec.mjs';
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'judu-library-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('SQLite online backup、源不变、哈希校验、凭据加密、修复不自动重试',async t=>{
 const root=await fixture(t),src=path.join(root,'source'),dst=path.join(root,'target');await mkdir(src);await mkdir(path.join(src,'originals'));await writeFile(path.join(src,'originals','a.txt'),'正文');
 const db=new DatabaseSync(path.join(src,'judu.sqlite'));db.exec('CREATE TABLE books(id TEXT);CREATE TABLE editions(id TEXT);CREATE TABLE chapters(id TEXT);CREATE TABLE paragraphs(id TEXT);');db.exec("CREATE TABLE ai_provider_configs(id TEXT,api_key TEXT); INSERT INTO ai_provider_configs VALUES('default','fake-secret');CREATE TABLE chat_messages(status TEXT);INSERT INTO chat_messages VALUES('streaming');");
 assert.equal(busyDatabase(db),1);db.exec("UPDATE chat_messages SET status='completed'");db.close();
 const before=await readFile(path.join(src,'judu.sqlite'));process.env.JUDU_DESKTOP_TOKEN='test';installSecretKey(Buffer.alloc(32,3));t.after(()=>delete process.env.JUDU_DESKTOP_TOKEN);
 await copyLibrary(src,dst);assert.deepEqual(await readFile(path.join(src,'judu.sqlite')),before);
 const target=new DatabaseSync(path.join(dst,'judu.sqlite'));const saved=target.prepare('SELECT api_key FROM ai_provider_configs').get().api_key;assert.equal(openSecret(saved),'fake-secret');assert.ok(!String(saved).includes('fake-secret'));
 target.exec("UPDATE chat_messages SET status='streaming'");target.close();
 assert.equal((await prepareLibrary(dst)).recovered,1);await checkLibrary(dst);
 await writeFile(path.join(dst,'desktop-library.json'),'{"version":999}');await assert.rejects(checkLibrary(dst));
});
test('书库子进程IPC准备与未来schema拒绝',async t=>{
 const root=await fixture(t);await runLibraryOperation(process.execPath,{operation:'prepare',directory:root},Buffer.alloc(32));
 const db=new DatabaseSync(path.join(root,'judu.sqlite'));db.exec('PRAGMA user_version=99');db.close();
 await assert.rejects(runLibraryOperation(process.execPath,{operation:'prepare',directory:root},Buffer.alloc(32)),/版本/);
});

test('忙碌与未来版本迁移拒绝；失败副本不泄露旧明文',async t=>{
 const root=await fixture(t),source=path.join(root,'source'),target=path.join(root,'target');await mkdir(source);
 const db=new DatabaseSync(path.join(source,'judu.sqlite'));db.exec('CREATE TABLE books(id TEXT);CREATE TABLE editions(id TEXT);CREATE TABLE chapters(id TEXT);CREATE TABLE paragraphs(id TEXT);');db.exec("CREATE TABLE chat_messages(status TEXT); INSERT INTO chat_messages VALUES('streaming');");
 await assert.rejects(copyLibrary(source,target),/仍有生成任务/);assert.deepEqual((await (await import('node:fs/promises')).readdir(root)).sort(),['source']);
 db.exec("UPDATE chat_messages SET status='completed'; PRAGMA user_version=99");await assert.rejects(copyLibrary(source,target),/版本/);db.close();
});
