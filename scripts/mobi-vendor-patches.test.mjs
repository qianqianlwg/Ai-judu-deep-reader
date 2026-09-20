// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { applyMobiPatches } from './mobi-vendor-patches.mjs';
const source=await readFile(new URL('../node_modules/@lingo-reader/mobi-parser/dist/index.node.mjs',import.meta.url),'utf8');
function writer(){
 const patched=applyMobiPatches(source),start=patched.indexOf('const resourceWriteBudgets = new Map();'),end=patched.indexOf('const mobiEncoding =',start);
 assert.ok(start>0&&end>start);
 /** @type {{url:string,size:number,flag:string}[]} */const writes=[];
 const save=runInNewContext(patched.slice(start,end)+'; saveResource',{Buffer,resolve,MimeToExt:{'image/png':'png'},writeFileSync:(/** @type {string} */url,/** @type {{byteLength:number}} */data,/** @type {{flag:string}} */options)=>{writes.push({url,size:data.byteLength,flag:options.flag});}});
 return {save,writes};
}
test('固定源码补丁拒绝锚点漂移，不能静默套到另一版本',()=>{assert.throws(()=>applyMobiPatches(source.replace('function saveResource(data, type, filename, imageSaveDir) {','function renamed() {')),/漂移/);});
test('资源单项与累计预算在IO之前拒绝，合成长度不分配超大字节',()=>{
 const {save,writes}=writer();assert.throws(()=>save({byteLength:104857601},'image/png','large','private'),/exceeds budget/);assert.equal(writes.length,0);
 save({byteLength:52428800},'image/png','1','private');save({byteLength:52428800},'image/png','2','private');assert.throws(()=>save({byteLength:1},'image/png','3','private'),/exceeds budget/);assert.equal(writes.length,2);assert.ok(writes.every(w=>w.flag==='wx'));
 save({byteLength:1},'image/png','1','other-private');assert.equal(writes.length,3);
});
test('第5001个资源在写入前拒绝，零长度和未知长度不创建文件',()=>{
 const {save,writes}=writer();for(const byteLength of [0,-1,NaN,Infinity,undefined])assert.throws(()=>save({byteLength},'image/png','bad','private'),/exceeds budget/);
 for(let index=0;index<5000;index++)save({byteLength:1},'image/png',String(index),'private');assert.throws(()=>save({byteLength:1},'image/png','5001','private'),/exceeds budget/);assert.equal(writes.length,5000);
});
