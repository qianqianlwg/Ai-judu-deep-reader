import { afterEach, expect, it, vi } from "vitest";
import type { MobiCandidate, TocItem } from "../../vendor/mobi/index.mjs";
import { buildMobiLayout } from "./mobi-layout-worker.mjs";
const resources=vi.hoisted(()=>({captureMobiResources:vi.fn()}));
vi.mock('./mobi-layout-resources.mjs',()=>resources);
afterEach(()=>vi.clearAllMocks());
function parser(html='<p id="note">真实目标</p><a href="kindle:pos:fid:0000:off:0000">注释</a>'):MobiCandidate {
 resources.captureMobiResources.mockResolvedValue({resources:[],rewrite:(s:string)=>s,idFor:(s:string)=>s});
 return {getMetadata:()=>({title:'书',author:['作者']}),getSpine:()=>[{id:'0'}],getSourceChapter:()=>({id:'0',encoding:65001,bytes:new TextEncoder().encode(html),spans:[{fid:0,start:0,end:new TextEncoder().encode(html).length,targetStart:0}]}),getToc:()=>[],getCoverImage:()=>'',getResourceAliases:()=>[],loadChapter:()=>({html,head:'<style>p{color:red}</style>',css:[]}),resolveHref:vi.fn(()=>({id:'0',selector:'[id="note"]'}))};
}
const input={bytes:new Uint8Array([1,2]),kind:'kf8' as const,resourceDir:'private'};
it('目录和内链只接受字节精确点，不依赖旧resolveHref猜下一个id',async()=>{const p=parser();p.getToc=()=>[{label:'章',href:'kindle:pos:fid:0000:off:0000'}];const result=await buildMobiLayout(p,input);expect(result.links[0]).toMatchObject({reason:'exact-source',target:{chapterId:'0',locator:'kindle:pos:fid:0000:off:0000',byteOffset:0,htmlOffset:0,point:{kind:'element',path:[0],tag:'p',offset:0}}});expect(result.toc[0].target).toEqual(result.links[0].target);expect(p.resolveHref).not.toHaveBeenCalled();});
it('缺少精确来源章节时失败而非退回启发式selector',async()=>{const p=parser();p.getSourceChapter=()=>undefined;await expect(buildMobiLayout(p,input)).rejects.toThrow('来源缺失');});
it('重复id不妨碍按真实来源位置定位；目录不得猜另一个重复段',async()=>{const p=parser('<p id="note">一</p><p id="note">二</p><a href="kindle:pos:fid:0000:off:0000">x</a>');const result=await buildMobiLayout(p,input);expect(result.links[0].target?.point).toMatchObject({kind:'element',path:[0],tag:'p'});expect(p.resolveHref).not.toHaveBeenCalled();});
it('外链和包含filepos子串的链接不会传到候选宽松resolver',async()=>{const p=parser('<a href="https://invalid.example/kindle:pos:fid:0000:off:0000">x</a><a href="abcfilepos:12">y</a><a href="//remote/x">z</a>');const result=await buildMobiLayout(p,input);expect(p.resolveHref).not.toHaveBeenCalled();expect(result.links.map(l=>l.reason)).toEqual(['external','external','external']);});
it('目录循环按深度限制中止，不能返回半个成功结果',async()=>{const p=parser();const cycle:TocItem={label:'循环',href:'',children:[]};cycle.children!.push(cycle);p.getToc=()=>[cycle];await expect(buildMobiLayout(p,input)).rejects.toThrow('超限');});
it('丢失章节或资源错误向上抛，不静默删除图片章',async()=>{const p=parser();p.loadChapter=()=>undefined;await expect(buildMobiLayout(p,input)).rejects.toThrow('无法读取');resources.captureMobiResources.mockRejectedValueOnce(new Error('resource failed'));await expect(buildMobiLayout(parser(),input)).rejects.toThrow('resource failed');});
it('资源别名必须对应已捕获资源，不能借另一资源声明使错误目标通过',async()=>{const p=parser();p.getResourceAliases=()=>[['kindle:embed:1?mime=image/png','mobi-resource-v1/1.png']];await expect(buildMobiLayout(p,input)).rejects.toThrow('未捕获');});
it('同文ID交换不能留下exact-source，即使旧resolveHref命中',async()=>{const raw='<p id="a">same</p><p id="b">same</p><a href="kindle:pos:fid:0:off:0">跳</a>',p=parser(raw);p.loadChapter=()=>({html:raw.replace('id="a"','id="x"').replace('id="b"','id="a"').replace('id="x"','id="b"'),head:'',css:[]});expect((await buildMobiLayout(p,input)).links[0]).toMatchObject({target:null,reason:'unresolved'});});
