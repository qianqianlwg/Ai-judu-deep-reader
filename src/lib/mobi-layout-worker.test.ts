import { afterEach, expect, it, vi } from "vitest";
import type { MobiCandidate, TocItem } from "../../vendor/mobi/index.mjs";
import { buildMobiLayout } from "./mobi-layout-worker.mjs";
const resources=vi.hoisted(()=>({captureMobiResources:vi.fn()}));
vi.mock('./mobi-layout-resources.mjs',()=>resources);
afterEach(()=>vi.clearAllMocks());
function parser(html='<p id="note">真实目标</p><a href="kindle:pos:fid:0000:off:0000">注释</a>'):MobiCandidate {
 resources.captureMobiResources.mockResolvedValue({resources:[],rewrite:(s:string)=>s,idFor:(s:string)=>s});
 return {getMetadata:()=>({title:'书',author:['作者']}),getSpine:()=>[{id:'0'}],getToc:()=>[],getCoverImage:()=>'',loadChapter:()=>({html,head:'<style>p{color:red}</style>',css:[]}),resolveHref:vi.fn(()=>({id:'0',selector:'[id="note"]'}))};
}
const input={bytes:new Uint8Array([1,2]),kind:'kf8' as const,resourceDir:'private'};
it('目录和内链只保留唯一存在元素的候选落点，非字节精确证明',async()=>{const p=parser();p.getToc=()=>[{label:'章',href:'kindle:pos:fid:0000:off:0000'}];const result=await buildMobiLayout(p,input);expect(result.links[0]).toMatchObject({reason:'verified-element',target:{chapterId:'0',attribute:'id',value:'note'}});expect(result.toc[0].target).toEqual(result.links[0].target);expect(result.chapters[0].head).toContain('<style>');});
it.each(['[id="missing"]','[id="note"],script','[name="unknown"]'])('解析器的%s不产生猜测替代目标',async selector=>{const p=parser();p.resolveHref=vi.fn(()=>({id:'0',selector}));const result=await buildMobiLayout(p,input);expect(result.links[0]).toMatchObject({reason:'unresolved',target:null});});
it('重复元素和另一不存在章节不能核准',async()=>{const p=parser('<p id="note">一</p><p id="note">二</p><a href="kindle:pos:fid:0000:off:0000">x</a>');expect((await buildMobiLayout(p,input)).links[0].target).toBeNull();p.resolveHref=()=>({id:'wrong',selector:'[id="note"]'});expect((await buildMobiLayout(p,input)).links[0].target).toBeNull();});
it('外链和包含filepos子串的链接不会传到候选宽松resolver',async()=>{const p=parser('<a href="https://invalid.example/kindle:pos:fid:0000:off:0000">x</a><a href="abcfilepos:12">y</a><a href="//remote/x">z</a>');const result=await buildMobiLayout(p,input);expect(p.resolveHref).not.toHaveBeenCalled();expect(result.links.map(l=>l.reason)).toEqual(['external','external','external']);});
it('目录循环按深度限制中止，不能返回半个成功结果',async()=>{const p=parser();const cycle:TocItem={label:'循环',href:'',children:[]};cycle.children!.push(cycle);p.getToc=()=>[cycle];await expect(buildMobiLayout(p,input)).rejects.toThrow('超限');});
it('丢失章节或资源错误向上抛，不静默删除图片章',async()=>{const p=parser();p.loadChapter=()=>undefined;await expect(buildMobiLayout(p,input)).rejects.toThrow('无法读取');resources.captureMobiResources.mockRejectedValueOnce(new Error('resource failed'));await expect(buildMobiLayout(parser(),input)).rejects.toThrow('resource failed');});
