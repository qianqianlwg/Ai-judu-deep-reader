// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { unusedLoopbackPort } from './server.mjs';
import { electronEnvironment } from './launch.mjs';

async function waitFor(check, timeout=60000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){ const value=await check(); if(value)return value; await delay(100); }
  throw new Error('桌面E2E等待超时');
}
async function cdp(url) {
  const socket=new WebSocket(url); let next=0; const pending=new Map();
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data)); const request=pending.get(message.id);if(!request)return;
    pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
  });
  socket.addEventListener('close',()=>{for(const request of pending.values())request.reject(new Error('CDP已关闭'));pending.clear();});
  return {close:()=>socket.close(),send:(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  })};
}

// WHY：默认单测不拉起用户桌面；专用E2E显式传入自造书库与新构建，不能把跳过当成GUI验收通过。
test('Electron真实窗口：隔离核心、导入、重启持久化与退出释放端口',{
  skip:!process.env.JUDU_DESKTOP_E2E_RELEASE_DIR,timeout:180000,
},async t=>{
  const require=createRequire(import.meta.url);const executable=require('electron');
  const releaseDir=process.env.JUDU_DESKTOP_E2E_RELEASE_DIR;
  assert.ok(releaseDir&&path.isAbsolute(releaseDir));
  const directory=await mkdtemp(path.join(os.tmpdir(),'judu-desktop-e2e-'));
  const appPath=path.dirname(fileURLToPath(import.meta.url));
  let active;let connection;let debugPort;const ports=[];let output='';
  const artifacts=process.env.JUDU_DESKTOP_E2E_ARTIFACTS;
  t.after(async()=>{
    connection?.close();if(active&&active.exitCode===null){
      const owned=active;await new Promise((resolve,reject)=>{const killer=spawn('taskkill.exe',['/PID',String(owned.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',reject);killer.once('exit',resolve);});await delay(300);
    }
    // 仅清理本测试创建且已解析的临时根；不会接触开发工程或正式书库。
    assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('judu-desktop-e2e-'));
    await rm(directory,{recursive:true,force:true});
  });
  async function launch(){
    debugPort=await unusedLoopbackPort();ports.push(debugPort);
    const env=electronEnvironment({...process.env,JUDU_DESKTOP_RELEASE_DIR:releaseDir,
      JUDU_DESKTOP_NODE_PATH:process.execPath,JUDU_DESKTOP_DATA_DIR:path.join(directory,'library'),JUDU_DESKTOP_PROFILE_DIR:path.join(directory,'profile')});
    delete env.AI_API_KEY;delete env.SILICONFLOW_API_KEY;delete env.OPENAI_API_KEY;delete env.ANTHROPIC_API_KEY;
    active=spawn(executable,[appPath,`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    for(const stream of [active.stdout,active.stderr])stream.on('data',chunk=>{output=(output+String(chunk)).slice(-32768);});
    active.on('error',error=>{output+=error.message;});
    const target=await waitFor(async()=>{
      if(active.exitCode!==null)throw new Error('Electron提前退出:'+output);
      try{const response=await fetch(`http://127.0.0.1:${debugPort}/json/list`,{signal:AbortSignal.timeout(1000)});const targets=await response.json();return targets.find(target=>target.type==='page'&&target.url.startsWith('http://127.0.0.1:'));}
      catch(error){if(error instanceof TypeError||error instanceof DOMException)return;throw error;}
    });
    const origin=new URL(target.url).origin;ports.push(Number(new URL(origin).port));
    connection=await cdp(target.webSocketDebuggerUrl);
    await waitFor(async()=>{
      const result=await connection.send('Runtime.evaluate',{expression:'document.readyState',returnByValue:true});return result.result.value==='complete';
    });
    return origin;
  }
  async function close(){
    const exited=new Promise(resolve=>active.once('exit',resolve));
    await connection.send('Runtime.evaluate',{expression:'window.close()'}).catch(()=>undefined);
    await Promise.race([exited,delay(15000).then(()=>{throw new Error('Electron关闭超时:'+output);})]);
    connection.close();connection=undefined;
  }
  try{
    let origin=await launch();
    assert.equal((await fetch(origin+'/')).status,200);
    assert.equal((await fetch(origin+'/api/books')).status,200);
    assert.equal((await fetch(origin+'/api/desktop/health')).status,404);
    const isolation=await connection.send('Runtime.evaluate',{expression:'({require:typeof require,process:typeof process})',returnByValue:true});
    assert.deepEqual(isolation.result.value,{require:'undefined',process:'undefined'});
    const form=new FormData();form.set('file',new File(['桌面隔离验收\n\n这是专为桌面测试创建的文本，不含用户正式书籍。'],'desktop-smoke.txt',{type:'text/plain'}));
    const imported=await fetch(origin+'/api/import',{method:'POST',headers:{Origin:origin},body:form});assert.ok(imported.ok,await imported.clone().text());
    const books=await(await fetch(origin+'/api/books')).json();const ids=books.map(book=>book.id);assert.ok(ids.length>=1);
    // WHY：安全策略必须在真实Electron窗口观察，不只断言配置常量。
    await connection.send('Runtime.evaluate',{expression:"window.location.assign('https://example.invalid/blocked')"});
    await delay(250);
    const guarded=await connection.send('Runtime.evaluate',{expression:'location.origin',returnByValue:true});assert.equal(guarded.result.value,origin);
    await connection.send('Runtime.evaluate',{expression:"window.open('https://example.invalid/popup')"});await delay(250);
    const targets=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();assert.equal(targets.filter(target=>target.type==='page').length,1);
    const duplicatePort=await unusedLoopbackPort();ports.push(duplicatePort);
    const duplicate=spawn(executable,[appPath,'--remote-debugging-port='+duplicatePort,'--remote-debugging-address=127.0.0.1'],{
      env:electronEnvironment({...process.env,JUDU_DESKTOP_RELEASE_DIR:releaseDir,JUDU_DESKTOP_NODE_PATH:process.execPath,JUDU_DESKTOP_DATA_DIR:path.join(directory,'library'),JUDU_DESKTOP_PROFILE_DIR:path.join(directory,'profile')}),
      windowsHide:true,stdio:'ignore'});
    t.after(()=>{if(duplicate.exitCode===null)duplicate.kill();});
    const duplicateCode=await new Promise((resolve,reject)=>{duplicate.once('error',reject);duplicate.once('exit',resolve);});assert.equal(duplicateCode,0);assert.equal(active.exitCode,null);
    assert.equal((await fetch(origin+'/api/books')).status,200);
    await close();origin=await launch();const restored=await(await fetch(origin+'/api/books')).json();assert.deepEqual(restored.map(book=>book.id),ids);
    await waitFor(async()=>{const visible=await connection.send('Runtime.evaluate',{expression:'document.body.innerText.includes('+JSON.stringify(restored[0].title)+')',returnByValue:true});return visible.result.value===true;});
    if(artifacts){await mkdir(artifacts,{recursive:true});const screenshot=await connection.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'desktop-p1.png'),Buffer.from(screenshot.data,'base64'));}
    await close();
    for(const port of ports){const server=await import('node:net').then(({createServer})=>createServer());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(undefined));});await new Promise(resolve=>server.close(resolve));}
    const report={electron:require('electron/package.json').version,node:process.version,ports,homepage:200,books:200,healthWithoutToken:404,rendererNodeIntegration:false,externalNavigationBlocked:true,popupBlocked:true,singleInstanceConfirmed:true,importedFixture:true,restartPreservedBookIds:true,portsReleased:true};
    if(artifacts)await writeFile(path.join(artifacts,'desktop-p1-e2e.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }catch(error){console.error(output);throw error;}
});
