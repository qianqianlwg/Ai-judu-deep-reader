import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{buildDesktopGuard}from'./build-desktop-guard.mjs';
test('固定源码编译的守护程序拒绝非自有PID',{skip:process.platform!=='win32'},async()=>{const file=await buildDesktopGuard(process.cwd());assert.equal(spawnSync(file,['0'],{windowsHide:true}).status,1);});
