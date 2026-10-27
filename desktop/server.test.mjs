// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { backendEnvironment, startDesktopServer } from './server.mjs';
import { createServer } from 'node:net';

/** @param {import('node:test').TestContext} t @param {string} [mode] */
async function fixture(t, mode='normal') {
  const directory=await mkdtemp(path.join(os.tmpdir(),'judu-desktop-server-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const entryPath=path.join(directory,'fixture.mjs');
  await writeFile(entryPath, `import http from 'node:http';import {spawn} from 'node:child_process';
const mode=${JSON.stringify(mode)};
if(mode==='exit')process.exit(7);
const worker=mode==='tree'?spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}):null;
if(worker)console.log('WORKER:'+worker.pid);
const server=http.createServer((request,response)=>{
 if(mode==='timeout'){response.writeHead(404);response.end();return;}
 if(request.headers['x-judu-desktop-token']!==process.env.JUDU_DESKTOP_TOKEN){response.writeHead(404);response.end();return;}
 response.setHeader('content-type','application/json');response.end(JSON.stringify({protocol:1,pid:mode==='identity'?0:process.pid}));
});
server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('message',message=>{if(message.type==='busy')process.send({id:message.id,count:2});if(message.type==='shutdown'){worker?.kill();server.close(()=>process.exit(0));}});
`);
  return {nodePath:process.execPath,releaseDir:directory,dataDir:path.join(directory,'data'),entryPath,timeoutMs:3000,shutdownMs:50};
}
/** @param {number} port */
async function canBind(port) {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(undefined));});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve(undefined)));
}
test('后台强制loopback、隔离数据和生产模式，并清除注入环境',()=>{
 const original={NODE_OPTIONS:'--require evil',NODE_PATH:'evil',ELECTRON_RUN_AS_NODE:'1',HOSTNAME:'0.0.0.0',JUDU_DATA_DIR:'formal'};
 const env=backendEnvironment(original,{port:3319,dataDir:'isolated',releaseDir:'core',token:'secret'});
 assert.equal(env.HOSTNAME,'127.0.0.1');assert.equal(env.JUDU_DATA_DIR,'isolated');assert.equal(env.JUDU_APP_ORIGIN,'http://127.0.0.1:3319');
 assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(original.JUDU_DATA_DIR,'formal');
});
test('只连接自有后台；退出幂等且释放验证端口',async t=>{
 const server=await startDesktopServer(await fixture(t)); t.after(()=>server.stop());
 assert.ok(server.pid); assert.ok(server.origin.startsWith('http://127.0.0.1:'));
 assert.equal((await fetch(server.origin+'/api/desktop/health')).status,404);
 await Promise.all([server.stop(),server.stop()]); await canBind(server.port);
 assert.throws(()=>process.kill(server.pid,0));
});
test('拒绝身份不符的端口，不把其他服务当作就绪',async t=>{
 await assert.rejects(startDesktopServer(await fixture(t,'identity')),/身份校验/);
});
test('就绪超时后清理自有后台',async t=>{
 await assert.rejects(startDesktopServer({...await fixture(t,'timeout'),timeoutMs:300}),/启动超时/);
});
test('窗口在启动期间关闭时取消并清理后台',async t=>{
 const controller=new AbortController();const options=await fixture(t,'timeout');
 const timer=setTimeout(()=>controller.abort(),150);t.after(()=>clearTimeout(timer));
 await assert.rejects(startDesktopServer({...options,signal:controller.signal}),error=>error instanceof Error&&error.name==='AbortError');
});
test('后台提前退出时报告失败，而不是等待满超时',async t=>{
 await assert.rejects(startDesktopServer(await fixture(t,'exit')),/提前退出/);
});
test('Windows 退出终止自有解析子进程树', {skip:process.platform!=='win32'},async t=>{
 let workerPid;const options=await fixture(t,'tree');
 const server=await startDesktopServer({...options,onLog:text=>{const match=/WORKER:(\d+)/.exec(text);if(match)workerPid=Number(match[1]);}});
 t.after(()=>server.stop());assert.ok(workerPid);await server.stop();
 assert.throws(()=>process.kill(workerPid,0));await canBind(server.port);
});

test("后台任务状态通过私有IPC返回，不暴露公有API",async t=>{const server=await startDesktopServer(await fixture(t));t.after(()=>server.stop());assert.equal(await server.busy(),2);await server.stop();});

test('保留来源端口，冲突时失败而不是静默换来源',async t=>{const owner=createServer();await new Promise(resolve=>owner.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>owner.close(resolve)));const port=owner.address().port;await assert.rejects(startDesktopServer({...await fixture(t),port}),/端口/);});
