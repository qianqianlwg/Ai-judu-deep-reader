import {createHash} from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { readMobiLayoutSnapshot, type MobiLayoutSnapshot } from "./mobi-layout-snapshot";
function valid(): MobiLayoutSnapshot { return {schema:'mobi-layout-untrusted-v3',kind:'kf8',sourceHash:'a'.repeat(64),title:'书',authors:['作者'],cover:'mobi-resource-v1/1.png',chapters:[{id:'0',title:'章',html:'<p id="p">文</p>',head:'<style>p{color:red}</style>',css:['mobi-resource-v1/1.css'],paragraphs:['文']}],resources:[{id:'mobi-resource-v1/1.png',mediaType:'image/png',bytes:new Uint8Array([1,2])},{id:'mobi-resource-v1/1.css',mediaType:'text/css',bytes:new Uint8Array([65])}],toc:[{label:'章',href:'kindle:pos:fid:0000:off:0000',depth:0,target:{chapterId:'0',htmlHash:createHash('sha256').update('<p id="p">文</p>').digest('hex'),locator:'kindle:pos:fid:0000:off:0000',byteOffset:0,htmlOffset:0,point:{kind:'element',path:[0],tag:'p',offset:0}}}],links:[{chapterId:'0',href:'https://invalid.example/',target:null,reason:'external'}]}; }
afterEach(()=>vi.restoreAllMocks());
it('严格公开快照保留不可信HTML/资源，并复制资源字节',()=>{const value=valid(),result=readMobiLayoutSnapshot(value);expect(result).toEqual(value);value.resources[0].bytes.fill(0);expect(result.resources[0].bytes[0]).toBe(1);});
it.each(['source','schema','extra','duplicate','css','cover','bytes','target','reason','depth','path'])("坏快照%s不能通过IPC",field=>{const v=valid();if(field==='source')v.sourceHash='bad';if(field==='schema')Object.assign(v,{schema:'safe-html'});if(field==='extra')Object.assign(v,{directory:'C:/private'});if(field==='duplicate')v.chapters.push(v.chapters[0]);if(field==='css')v.chapters[0].css=['file:///secret'];if(field==='cover')v.cover='mobi-resource-v1/missing.png';if(field==='bytes')v.resources[0].bytes=new Uint8Array();if(field==='target')v.toc[0].target!.chapterId='other';if(field==='reason')v.links[0].reason='exact-source';if(field==='depth')v.toc[0].depth=129;if(field==='path')v.resources[0].id='../secret.png';expect(()=>readMobiLayoutSnapshot(v)).toThrow('无效或超限');});
it('资源预算在复制前核对，不分配超大资源副本',()=>{const v=valid();v.resources[0].bytes=new Uint8Array(100*1024*1024);const spy=vi.spyOn(Uint8Array.prototype,'slice');expect(()=>readMobiLayoutSnapshot(v)).toThrow();expect(spy).not.toHaveBeenCalled();});
it.each(['hash-newline','path-newline','mime','cover-css','sparse-chapters','sparse-authors','sparse-css'])("严格边界%s拒绝",field=>{const v=valid();if(field==='hash-newline')v.sourceHash+='\n';if(field==='path-newline')v.resources[0].id+='\n';if(field==='mime')v.resources[0].mediaType='text/css';if(field==='cover-css')v.cover='mobi-resource-v1/1.css';if(field==='sparse-chapters')v.chapters=new Array(1);if(field==='sparse-authors')v.authors=new Array(1);if(field==='sparse-css')v.chapters[0].css=new Array(1);expect(()=>readMobiLayoutSnapshot(v)).toThrow('无效或超限');});
it('CSS资源的MIME角色不能被HTML替换',()=>{const v=valid();v.resources[1].mediaType='text/html';expect(()=>readMobiLayoutSnapshot(v)).toThrow('无效或超限');});
it.each(['v1','different-locator','wrong-kind','sparse-point','bad-offset','bad-hash'])('精确来源协议拒绝%s',field=>{
 const value=valid(),target=value.toc[0].target!;
 if(field==='v1')Object.assign(value,{schema:'mobi-layout-untrusted-v1'});
 if(field==='different-locator')target.locator='kindle:pos:fid:1:off:0';
 if(field==='wrong-kind'){target.locator='filepos:0';value.toc[0].href='filepos:0';}
 if(field==='sparse-point')target.point.path=new Array(1);
 if(field==='bad-offset')target.byteOffset=-1;
 if(field==='bad-hash')target.point={kind:'text',path:[0,0],offset:0,textLength:1,textHash:'a'.repeat(63)+'\n'};
 expect(()=>readMobiLayoutSnapshot(value)).toThrow('无效或超限');
});
it('空路径不能作为正文子节点协议传出',()=>{
 const value=valid();value.toc[0].target!.point={kind:'element',path:[],tag:'body',offset:0};expect(()=>readMobiLayoutSnapshot(value)).toThrow();
});
it('旧v2没有正文hash绑定，不能按新协议接收',()=>{const value=valid();Object.assign(value,{schema:'mobi-layout-untrusted-v2'});expect(()=>readMobiLayoutSnapshot(value)).toThrow();});
