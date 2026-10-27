import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm}from'node:fs/promises';import path from'node:path';import os from'node:os';import {createServer}from'node:http';import {observeRuntimeActivity}from'./runtime-activity.mjs';
test('被动追踪未完成POST，不修改HTTP服务',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'judu-activity-'));t.after(()=>rm(dir,{recursive:true,force:true}));const activity=observeRuntimeActivity(dir);t.after(()=>activity.close());
 let reply;const received=new Promise(resolve=>reply=resolve);let response;
 const server=createServer((_req,res)=>{response=res;reply();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const pending=fetch('http://127.0.0.1:'+server.address().port,{method:'POST'});await received;assert.equal(await activity.busy(),1);response.end('ok');await pending;assert.equal(await activity.busy(),0);
});
