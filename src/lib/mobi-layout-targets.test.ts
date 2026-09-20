import{expect,it}from'vitest';
import{createHash}from'node:crypto';
import{verifyMobiLayoutTargets}from'./mobi-layout-targets.mjs';
import{readMobiLayoutSnapshot,type MobiLayoutSnapshot}from'./mobi-layout-snapshot';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function snapshot():MobiLayoutSnapshot{
 const html='<p id="a">A😀B</p>';
 return{schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,resources:[],chapters:[{id:'c',title:'章',html,head:'',css:[],paragraphs:[]}],toc:[],links:[{chapterId:'c',href:'filepos:11',reason:'exact-source',target:{chapterId:'c',htmlHash:hash(html),locator:'filepos:11',byteOffset:11,htmlOffset:11,point:{kind:'text',path:[0,0],offset:1,textLength:4,textHash:hash('A😀B')}}}]};
}
it('正文SHA、节点全文与Unicode边界匹配才通过worker语义复核',()=>{const value=snapshot();expect(readMobiLayoutSnapshot(value)).toEqual(value);expect(()=>verifyMobiLayoutTargets(value)).not.toThrow();value.links[0].target!.point={kind:'element',path:[0],tag:'p',offset:0};expect(()=>verifyMobiLayoutTargets(value)).not.toThrow();});
it.each(['missing-path','wrong-hash','half-surrogate','wrong-length','missing-chapter','wrong-tag','implicit-element'] as const)('worker拒绝内部反例%s，不能拿IPC形状检查冒充语义检查',variant=>{
 const value=snapshot(),target=value.links[0].target!;if(target.point.kind!=='text')throw new Error('fixture');
 if(variant==='missing-path')target.point.path=[999,0];
 if(variant==='wrong-hash')target.point.textHash=hash('B😀A');
 if(variant==='half-surrogate')target.point.offset=2;
 if(variant==='wrong-length')target.point.textLength=8;
 if(variant==='missing-chapter')target.chapterId='unknown';
 if(variant==='wrong-tag')target.point={kind:'element',path:[0],tag:'div',offset:0};
 if(variant==='implicit-element'){value.chapters[0].html='<table><tr><td>x</td></tr></table>';target.htmlHash=hash(value.chapters[0].html);target.point={kind:'element',path:[0,0],tag:'tbody',offset:0};}
 expect(()=>verifyMobiLayoutTargets(value)).toThrow(/目标/);
});
it('旧target不能在相同path的替换正文上复活，IPC和worker均绑定实际HTML hash',()=>{const value=snapshot();value.chapters[0].html='<p id="a">B😀A</p>';expect(()=>readMobiLayoutSnapshot(value)).toThrow();expect(()=>verifyMobiLayoutTargets(value)).toThrow('节点不一致');});
it('正文容器根节点不是可携带的元素来源，空目标和外链不触发解析',()=>{const value=snapshot();value.links[0].target=null;value.links[0].reason='unresolved';expect(()=>verifyMobiLayoutTargets(value)).not.toThrow();});
it('无HTML重解析也能拒绝filepos与章节相对偏移矛盾',()=>{const value=snapshot();value.links[0].href='filepos:3';value.links[0].target!.locator='filepos:3';expect(()=>readMobiLayoutSnapshot(value)).toThrow();});
