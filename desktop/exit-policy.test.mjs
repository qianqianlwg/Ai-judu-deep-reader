import test from'node:test';import assert from'node:assert/strict';import{confirmDesktopExit}from'./exit-policy.mjs';
test('空闲直接退出，忙碌取消/强制遵守选择，不隐式重试模型',async()=>{
 const base={busy:async()=>1,choose:async()=> 'cancel',waiting:()=>false,pause:async()=>{},onWaiting:()=>{}};
 assert.equal(await confirmDesktopExit({...base,busy:async()=>0}),true);assert.equal(await confirmDesktopExit(base),false);assert.equal(await confirmDesktopExit({...base,choose:async()=> 'force'}),true);
});
test('等待排空与菜单取消，状态异常上抛不冒充排空',async()=>{
 let waiting=false,n=0;const events=[];const base={busy:async()=>++n<3?1:0,choose:async()=> 'wait',waiting:()=>waiting,pause:async()=>{},onWaiting:value=>{waiting=value;events.push(value);}};
 assert.equal(await confirmDesktopExit(base),true);assert.deepEqual(events,[true,false]);n=0;assert.equal(await confirmDesktopExit({...base,pause:async()=>{waiting=false;}}),false);
 n=0;await assert.rejects(confirmDesktopExit({...base,pause:async()=>{throw new Error('state unavailable');}}),/state unavailable/);assert.equal(waiting,false);
});
