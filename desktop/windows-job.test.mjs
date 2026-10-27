import test from 'node:test';import assert from 'node:assert/strict';import {spawn}from'node:child_process';import {guardWindowsProcess,spawnWindowsGuard}from'./windows-job.mjs';
test('Windows Job关闭杀掉自有进程树',{skip:process.platform!=='win32',timeout:30000},async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('exit',resolve));const guard=await guardWindowsProcess(child.pid);await guard.close();await closed;assert.throws(()=>process.kill(child.pid,0));
});

test("守护程序无法创建时明确失败，不等待永不发生的exit事件",{timeout:3000},async()=>{await assert.rejects(spawnWindowsGuard("Z:\\judu-no-such-guard.exe",123),/ENOENT/);});
