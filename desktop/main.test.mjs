// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { unusedLoopbackPort } from './server.mjs';
import { electronEnvironment } from './launch.mjs';
import {runHttpSmokeChecks}from'../scripts/smoke-release.mjs';
import {verifyRelease}from'../scripts/release-manifest.mjs';
import {DatabaseSync}from'node:sqlite';
import{createServer}from'node:http';

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
  const require=createRequire(import.meta.url);const executable=process.env.JUDU_DESKTOP_E2E_EXECUTABLE||require('electron');
  const releaseDir=process.env.JUDU_DESKTOP_E2E_RELEASE_DIR;
  assert.ok(releaseDir&&path.isAbsolute(releaseDir));
  const retained=process.env.JUDU_DESKTOP_E2E_KEEP_DIR;
  const directory=retained?path.resolve(retained):await mkdtemp(path.join(os.tmpdir(),'judu-desktop-e2e-'));if(retained)await mkdir(directory,{recursive:false});
  const appPath=path.dirname(fileURLToPath(import.meta.url));
  let active;let connection;let debugPort;const ports=[];let output='';let phase='startup';
  const artifacts=process.env.JUDU_DESKTOP_E2E_ARTIFACTS;
  t.after(async()=>{
    connection?.close();if(active&&active.exitCode===null){
      const owned=active;await new Promise((resolve,reject)=>{const killer=spawn('taskkill.exe',['/PID',String(owned.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',reject);killer.once('exit',resolve);});await delay(300);
    }
    // 仅清理本测试创建且已解析的临时根；不会接触开发工程或正式书库。
    if(!retained){assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('judu-desktop-e2e-'));await rm(directory,{recursive:true,force:true});}
  });
  async function launch(){
    debugPort=await unusedLoopbackPort();ports.push(debugPort);
    const env=electronEnvironment({...process.env,JUDU_DESKTOP_RELEASE_DIR:releaseDir,
      JUDU_DESKTOP_NODE_PATH:process.execPath,JUDU_DESKTOP_DATA_DIR:path.join(directory,'library'),JUDU_DESKTOP_PROFILE_DIR:path.join(directory,'profile')});
    if(process.env.JUDU_DESKTOP_E2E_PATH_ISOLATED){delete env.PATH;delete env.Path;env.Path=path.join(process.env.SystemRoot||'C:\\Windows','System32')+';'+path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0');}
    delete env.AI_API_KEY;delete env.SILICONFLOW_API_KEY;delete env.OPENAI_API_KEY;delete env.ANTHROPIC_API_KEY;
    await mkdir(path.join(directory,'profile'),{recursive:true});await writeFile(path.join(directory,'profile','library-choice.json'),JSON.stringify({directory:path.join(directory,'library')}));
    active=spawn(executable,[...(process.env.JUDU_DESKTOP_E2E_EXECUTABLE?['--profile-dir='+path.join(directory,'profile')]:[appPath]),`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    const formats=await runHttpSmokeChecks(origin,await verifyRelease(releaseDir));
    assert.equal((await fetch(origin+'/')).status,200);
    assert.equal((await fetch(origin+'/api/books')).status,200);
    assert.equal((await fetch(origin+'/api/desktop/health')).status,404);
    const isolation=await connection.send('Runtime.evaluate',{expression:'({require:typeof require,process:typeof process})',returnByValue:true});
    assert.deepEqual(isolation.result.value,{require:'undefined',process:'undefined'});
    const form=new FormData();form.set('file',new File(['桌面隔离验收\n\n这是专为桌面测试创建的文本，不含用户正式书籍。'],'desktop-smoke.txt',{type:'text/plain'}));
    const imported=await fetch(origin+'/api/import',{method:'POST',headers:{Origin:origin},body:form});assert.ok(imported.ok,await imported.clone().text());
    const book=await imported.json();
    const selected=book.chapters[0].paragraphs.find(paragraph=>Array.from(paragraph.text).length>=10);assert.ok(selected);
    let modelCalls=0;
    const fixture=createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);modelCalls++;
      assert.equal(req.headers.authorization,'Bearer desktop-fixture-not-a-real-secret');
      const reading=body.tools?.some(tool=>tool.function.name==='submit_reading_sentence');
      const guide=body.tools?.some(tool=>tool.function.name==='update_reading_guide');
      const name=guide?'update_reading_guide':reading?'submit_reading_sentence':'mark_answer_emphasis';
      const guideContext=guide?JSON.parse(body.messages.find(message=>message.role==='user').content):null;
      const args=guide?{reason:'隔离夹具验证来源闭环',upserts:[{id:'new-fixture',parentId:null,title:'夹具导读',summary:'隔离模型夹具依据固定释读生成的主题，用于验证来源保存与回跳。',sourceIds:guideContext.analyses.map(item=>item.sourceId)}],removeIds:[]}:reading?{sourceStart:selected.text.slice(0,8),sourceEnd:selected.text.slice(-8),title:'隔离夹具释读',content:'固定测试释读，不是真实模型验收。',sourceAnnotations:{keywords:'none',keySentences:'none',concepts:'none'},answerEmphasis:{keywords:'none',keySentences:'none'}}:{answerEmphasis:{keywords:'none',keySentences:'none'}};
      res.writeHead(200,{'content-type':'text/event-stream'});
      if(!reading&&!guide)res.write('data: '+JSON.stringify({id:'chat-fixture-'+modelCalls,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'隔离模型夹具回答。'},finish_reason:null}]})+'\n\n');
      if(!body.tools?.length){res.end('data: '+JSON.stringify({id:'chat-fixture-'+modelCalls,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;}
      res.end('data: '+JSON.stringify({id:'chat-fixture-'+modelCalls,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'fixture-call-'+modelCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');
    });
    await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));t.after(()=>fixture.close());
    const fixturePort=fixture.address().port;ports.push(fixturePort);
    const settings=await fetch(origin+'/api/settings/ai',{method:'PUT',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({provider:'openai',baseUrl:'http://127.0.0.1:'+fixturePort+'/v1',apiKey:'desktop-fixture-not-a-real-secret',model:'fixture-model'})});
    assert.equal(settings.status,200,await settings.clone().text());
    const threadId=crypto.randomUUID(),assistantId=crypto.randomUUID();
    const thread=await fetch(origin+'/api/threads',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({threadId,editionId:book.editionId})});assert.equal(thread.status,201,await thread.clone().text());
    const stream=await fetch(origin+'/api/analyze/stream',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({threadId,clientUserMessageId:crypto.randomUUID(),clientAssistantMessageId:assistantId,editionId:book.editionId,chapterId:book.chapters[0].id,paragraphId:selected.id,mode:'chat',question:'请解释这段文字',selectedText:selected.text,selectionStart:0,selectionEnd:selected.text.length})});
    const result=await stream.text();assert.equal(stream.status,200,result);assert.match(result,/event: done/);assert.ok(!result.includes('event: error'),result);assert.ok(modelCalls>0);
    const embedding=await fetch(origin+'/api/settings/embedding',{method:'PUT',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({apiKey:'desktop-fixture-embedding',baseUrl:'http://127.0.0.1:'+fixturePort+'/v1',model:'fixture-embedding',agentSemanticEnabled:false})});assert.equal(embedding.status,200,await embedding.clone().text());
    const analysisId=crypto.randomUUID();
    const analysisStream=await fetch(origin+'/api/analyze/stream',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({threadId,clientUserMessageId:crypto.randomUUID(),clientAssistantMessageId:analysisId,editionId:book.editionId,bookId:book.id,chapterId:book.chapters[0].id,paragraphId:selected.id,mode:'analyze',question:'请释读这段原文',selectedText:selected.text,selectionStart:0,selectionEnd:selected.text.length})});
    const analysisText=await analysisStream.text();assert.equal(analysisStream.status,200,analysisText);assert.match(analysisText,/event: done/);assert.ok(!analysisText.includes('event: error'),analysisText);
    await waitFor(async()=>{const db=new DatabaseSync(path.join(directory,'library','judu.sqlite'),{readOnly:true});try{const jobs=db.prepare('SELECT status,error FROM guide_sources').all();if(jobs.some(job=>job.status==='failed'))throw new Error(JSON.stringify(jobs));return jobs.length>0&&jobs.every(job=>job.status==='completed');}finally{db.close();}},30000);
    const {hasApiKey:speechHasKey,model:speechModel,...speechPreferences}=await(await fetch(origin+'/api/settings/speech')).json();assert.equal(typeof speechHasKey,'boolean');assert.equal(typeof speechModel,'string');
    const speech=await fetch(origin+'/api/settings/speech',{method:'PUT',headers:{Origin:origin,'content-type':'application/json'},body:JSON.stringify({...speechPreferences,apiKey:'desktop-fixture-speech'})});assert.equal(speech.status,200,await speech.clone().text());
    const speechFile=await readFile(path.join(directory,'library','speech-settings.json'),'utf8');assert.ok(!speechFile.includes('desktop-fixture-speech'));assert.ok(speechFile.includes('judu-dpapi-v1:'));
    const database=new DatabaseSync(path.join(directory,'library','judu.sqlite'),{readOnly:true});
    const saved=database.prepare('SELECT api_key FROM ai_provider_configs WHERE id=\'default\'').get().api_key;
    assert.ok(String(saved).startsWith('judu-dpapi-v1:'));assert.ok(!String(saved).includes('desktop-fixture-not-a-real-secret'));
    assert.equal(database.prepare('SELECT status FROM chat_messages WHERE id=?').get(assistantId).status,'completed');database.close();
    const semanticDb=new DatabaseSync(path.join(directory,'library','judu.sqlite'),{readOnly:true});const semantic=JSON.parse(semanticDb.prepare('SELECT structured_output FROM chat_messages WHERE id=?').get(analysisId).structured_output);assert.ok(semantic.semantic.units.some(unit=>unit.status==='completed'));semanticDb.close();
    const vault=await readFile(path.join(directory,'library','desktop-vault.bin'));assert.ok(vault.length>32);
    const books=await(await fetch(origin+'/api/books')).json();const ids=books.map(book=>book.id);assert.ok(ids.length>=1);
    // WHY：安全策略必须在真实Electron窗口观察，不只断言配置常量。
    await connection.send('Runtime.evaluate',{expression:"window.location.assign('https://example.invalid/blocked')"});
    await delay(250);
    const guarded=await connection.send('Runtime.evaluate',{expression:'location.origin',returnByValue:true});assert.equal(guarded.result.value,origin);
    await connection.send('Runtime.evaluate',{expression:"window.open('https://example.invalid/popup')"});await delay(250);
    const targets=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();assert.equal(targets.filter(target=>target.type==='page').length,1);
    const duplicatePort=await unusedLoopbackPort();ports.push(duplicatePort);
    const duplicate=spawn(executable,[...(process.env.JUDU_DESKTOP_E2E_EXECUTABLE?['--profile-dir='+path.join(directory,'profile')]:[appPath]),'--remote-debugging-port='+duplicatePort,'--remote-debugging-address=127.0.0.1'],{
      env:electronEnvironment({...process.env,JUDU_DESKTOP_RELEASE_DIR:releaseDir,JUDU_DESKTOP_NODE_PATH:process.execPath,JUDU_DESKTOP_DATA_DIR:path.join(directory,'library'),JUDU_DESKTOP_PROFILE_DIR:path.join(directory,'profile')}),
      windowsHide:true,stdio:'ignore'});
    t.after(()=>{if(duplicate.exitCode===null)duplicate.kill();});
    const duplicateCode=await new Promise((resolve,reject)=>{duplicate.once('error',reject);duplicate.once('exit',resolve);});assert.equal(duplicateCode,0);assert.equal(active.exitCode,null);
    assert.equal((await fetch(origin+'/api/books')).status,200);
    await connection.send('Runtime.evaluate',{expression:"localStorage.setItem('judu:desktop-acceptance','reading-state')"});
    const priorOrigin=origin;await close();origin=await launch();
    const retainedState=(await connection.send('Runtime.evaluate',{expression:"localStorage.getItem('judu:desktop-acceptance')",returnByValue:true})).result.value;
    const stableOrigin=origin===priorOrigin&&retainedState==='reading-state';if(process.env.JUDU_DESKTOP_E2E_STABLE_ORIGIN)assert.ok(stableOrigin,'阅读来源与localStorage必须跨重启保留');
    const unlocked=await(await fetch(origin+'/api/settings/ai')).json();assert.equal(unlocked.hasApiKey,true);assert.match(unlocked.maskedApiKey,/desk/);
    assert.equal((await(await fetch(origin+'/api/settings/embedding')).json()).hasApiKey,true);assert.equal((await(await fetch(origin+'/api/settings/speech')).json()).hasApiKey,true);
    const history=await(await fetch(origin+'/api/threads/'+threadId+'?editionId='+book.editionId)).json();assert.ok(JSON.stringify(history).includes(assistantId));
    await new Promise(resolve=>fixture.close(resolve));const restored=await(await fetch(origin+'/api/books')).json();assert.deepEqual(restored.map(book=>book.id),ids);
    await waitFor(async()=>{const visible=await connection.send('Runtime.evaluate',{expression:'document.body.innerText.includes('+JSON.stringify(restored[0].title)+')',returnByValue:true});return visible.result.value===true;});
    const rendered=[];
    for(const extension of ['.txt','.md','.epub','.pdf','.mobi','.fb2','.fbz','.cbz']){
      phase='render:'+extension;console.log(phase);const target=restored.find(item=>item.edition?.fileType===extension);assert.ok(target,extension);
      await connection.send('Page.navigate',{url:origin+'/?bookId='+target.id+'&editionId='+target.editionId});
      await waitFor(async()=>{
        const state=await connection.send('Runtime.evaluate',{expression:`(()=>{if(document.readyState!=='complete')return null;const r=document.querySelector('.epub-reader,.pdf-reader,.cbz-reader');if(r){const e=r.querySelector('[role="alert"]');if(e)return {error:e.textContent};if(r.getAttribute('aria-busy')==='true'||(r.matches('.cbz-reader')&&r.querySelector('[aria-busy="true"]')))return null;return {ready:true};}return document.body.innerText.includes(${JSON.stringify(target.chapters[0]?.paragraphs[0]?.text||'__no_text__')})?{ready:true}:null;})()`,returnByValue:true});
        const value=state.result.value;if(value?.error)throw new Error(extension+'原版失败: '+value.error);return value?.ready;
      },30000);rendered.push(extension);
      if(artifacts){await mkdir(artifacts,{recursive:true});const shot=await connection.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'reader-'+extension.slice(1)+'.png'),Buffer.from(shot.data,'base64'));}
    }
    if(artifacts){await mkdir(artifacts,{recursive:true});const screenshot=await connection.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'desktop-acceptance.png'),Buffer.from(screenshot.data,'base64'));}
    await close();
    for(const port of ports){const server=await import('node:net').then(({createServer})=>createServer());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(undefined));});await new Promise(resolve=>server.close(resolve));}
    const report={stableOrigin,localStorageRestored:stableOrigin,systemNodeOnPath:!Boolean(process.env.JUDU_DESKTOP_E2E_PATH_ISOLATED),packaged:Boolean(process.env.JUDU_DESKTOP_E2E_EXECUTABLE),renderedFormats:rendered,formats:formats.importedFormats,dpapiVault:true,providerEncryptedAtRest:true,speechEncryptedAtRest:true,embeddingKeyRestored:true,fixtureModelCalls:modelCalls,realModelCalled:false,streamCompleted:true,readingAnalysisCompleted:true,guideFixtureCompleted:true,threadPreserved:true,electron:require('electron/package.json').version,node:process.version,ports,homepage:200,books:200,healthWithoutToken:404,rendererNodeIntegration:false,externalNavigationBlocked:true,popupBlocked:true,singleInstanceConfirmed:true,importedFixture:true,restartPreservedBookIds:true,portsReleased:true};
    if(artifacts)await writeFile(path.join(artifacts,'desktop-acceptance.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }catch(error){
    console.error('phase='+phase,output);
    if(connection){const state=await connection.send('Runtime.evaluate',{expression:'({url:location.href,text:document.body.innerText.slice(0,5000)})',returnByValue:true});console.error(JSON.stringify(state));
      if(artifacts){await mkdir(artifacts,{recursive:true});const shot=await connection.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(artifacts,'failure.png'),Buffer.from(shot.data,'base64'));}}
    throw error;
  }
});
