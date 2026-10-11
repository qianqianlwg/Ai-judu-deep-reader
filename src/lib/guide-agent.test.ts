import { afterEach,describe,expect,it,vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
const fixture=vi.hoisted(()=>({invoke:vi.fn(),bind:vi.fn(),model:vi.fn()}));
vi.mock('./agent/model',()=>({createReadingModel:(...args:unknown[])=>{fixture.model(...args);return {bindTools:fixture.bind};}}));
import { guideInitialContext,planGuide,guideAgentPatchSchema,GUIDE_PROMPT,GUIDE_TOOL_SCHEMA } from './guide-agent';
import type { GuidePatch } from './guide';
import type { GuidePlanInput } from './guide-worker';
const summary='实践是认识的来源，认识应通过实践检验并持续修正。';
const input:GuidePlanInput={bookId:'b',nodes:[],source:{id:'m',bookId:'b',editionId:'e',threadId:'t',messageId:'m',chapterId:'c',chapterTitle:'一',createdAt:'now',analysisText:'主Agent已经解释认识与实践的关系，强调从实践中形成认识并回到实践检验。',anchor:{paragraphId:'p',startOffset:0,endOffset:6,selectedText:'认识来自实践'}},readSources:()=>[],signal:new AbortController().signal};
const config={provider:'openai' as const,baseUrl:'https://example.invalid/v1',apiKey:'test',model:'test'};
const patch=():GuidePatch=>({reason:'整理本次句读',upserts:[{id:'new-practice',parentId:null,title:'实践',summary,sourceIds:['m']}],removeIds:[]});
const response=(args:Record<string,unknown>)=>new AIMessage({content:'',tool_calls:[{name:'update_reading_guide',id:'call',args}]});
afterEach(()=>vi.clearAllMocks());
describe('简化导读子Agent',()=>{
 it('注入按需框架和完整分析，装配只读查询与批量修改工具',async()=>{fixture.bind.mockReturnValue({invoke:fixture.invoke});fixture.invoke.mockResolvedValue(response(patch()));const result=await planGuide(config,input);expect(result.patch.upserts[0].id).toBe('m:new-practice');expect((fixture.bind.mock.calls[0][0] as {name:string}[]).map(t=>t.name)).toEqual(['update_reading_guide','read_reading_guide']);expect(fixture.model).toHaveBeenCalledWith(config);expect(guideInitialContext(input)).toMatchObject({framework:{nodes:[]},analyses:[{sourceId:'m',analysis:input.source.analysisText}]});expect(GUIDE_PROMPT.length).toBeLessThan(180);});
 it('一次提交多个完整节点，保持父子关系且来源只接受本次或已有依据',async()=>{fixture.bind.mockReturnValue({invoke:fixture.invoke});const args=patch();args.upserts.push({id:'new-child',parentId:'new-practice',title:'检验',summary,sourceIds:['m']});fixture.invoke.mockResolvedValue(response(args));const result=await planGuide(config,input);expect(result.patch.upserts).toHaveLength(2);expect(result.patch.upserts[1].parentId).toBe('m:new-practice');expect(fixture.invoke).toHaveBeenCalledOnce();});
 it('伪造来源交回修正，不假装保存成功',async()=>{fixture.bind.mockReturnValue({invoke:fixture.invoke});fixture.invoke.mockResolvedValueOnce(response({...patch(),upserts:[{...patch().upserts[0],sourceIds:['unread']}]})).mockResolvedValueOnce(response(patch()));expect((await planGuide(config,input)).patch.upserts[0].sourceIds).toEqual(['m']);expect(fixture.invoke).toHaveBeenCalledTimes(2);});
 it('大图注入受预算控制，摘要要么完整注入要么明确待查询，不本地改写',()=>{const nodes=Array.from({length:1000},(_,i)=>({id:String(i),parentId:i?'0':null,title:'主题',summary:summary.repeat(30),sourceIds:['m']}));const context=guideInitialContext({...input,nodes});expect(context.framework.nodes.length).toBeLessThan(1000);expect(context.framework.budgetLimited).toBe(true);expect(context.framework.nodes.every(n=>!n.detailsIncluded||n.summary===nodes[0].summary)).toBe(true);});
 it('每节点摘要20–100Unicode字，来源1–5个，字段必须由Agent明确提交',()=>{expect(guideAgentPatchSchema.safeParse(patch()).success).toBe(true);for(const summary of ['太短','长'.repeat(101)])expect(guideAgentPatchSchema.safeParse({...patch(),upserts:[{...patch().upserts[0],summary}]}).success).toBe(false);for(const sourceIds of [[],['1','2','3','4','5','6'],['m','m']])expect(guideAgentPatchSchema.safeParse({...patch(),upserts:[{...patch().upserts[0],sourceIds}]}).success).toBe(false);expect(guideAgentPatchSchema.safeParse({...patch(),upserts:[{...patch().upserts[0],summary:'😀'.repeat(20)}]}).success).toBe(true);});
 it('分析或ID缺失明确停止，不使用原文或空字段补齐',()=>{expect(()=>guideInitialContext({...input,source:{...input.source,analysisText:undefined}})).toThrow('缺失');expect(()=>guideInitialContext({...input,source:{...input.source,id:''}})).toThrow('缺失');});
});

it('批次少一则来源交回Agent修正，不把所有历史句读假装已纳入图',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});
 const extra={...input.source,id:'second',analysisText:'第二条主Agent释读'};
 fixture.invoke.mockResolvedValueOnce(response(patch())).mockResolvedValueOnce(response({...patch(),upserts:[{...patch().upserts[0],sourceIds:['m','second']}]}));
 const result=await planGuide(config,{...input,sources:[input.source,extra]});expect(result.patch.upserts[0].sourceIds).toEqual(['m','second']);
 expect(fixture.invoke).toHaveBeenCalledTimes(2);expect(JSON.stringify(fixture.invoke.mock.calls[1])).toContain('second');
});

const query=(args:Record<string,unknown>,id='read-call')=>new AIMessage({content:'',tool_calls:[{name:'read_reading_guide',id,args}]});
const deepNodes=()=>[
 {id:'old',parentId:null,title:'旧二级',summary,sourceIds:['m']},
 {id:'old-3',parentId:'old',title:'旧三级',summary,sourceIds:['m']},
 {id:'old-4',parentId:'old-3',title:'旧四级',summary,sourceIds:['m']},
 {id:'latest',parentId:null,title:'最新二级',summary,sourceIds:['m']},
];
it('可以按需展开母节点、获取隐藏节点详情，再批量提交，读取不修改原图',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});const nodes=deepNodes(),before=structuredClone(nodes);
 fixture.invoke.mockResolvedValueOnce(query({action:'children',nodeId:'old-3'})).mockResolvedValueOnce(query({action:'details',nodeId:'old-4'})).mockResolvedValueOnce(response({reason:'增补旧主题',upserts:[{...nodes[2],summary}],removeIds:[]}));
 const result=await planGuide(config,{...input,nodes});expect(result.patch.upserts[0].id).toBe('old-4');expect(nodes).toEqual(before);
 const last=JSON.stringify(fixture.invoke.mock.calls[2][0]);expect(last).toContain('旧四级');expect(last).toContain('nextSummaryOffset');
 expect(fixture.bind.mock.calls[0][1]).toEqual({tool_choice:'auto'});
});
it('未读取隐藏节点就修改会反馈错误，伪造查询ID不被当作成功',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});const nodes=deepNodes();
 fixture.invoke.mockResolvedValueOnce(response({reason:'修改',upserts:[{...nodes[2],summary}],removeIds:[]}))
 .mockResolvedValueOnce(query({action:'details',nodeId:'fake'}))
 .mockResolvedValueOnce(query({action:'details',nodeId:'old-4'}))
 .mockResolvedValueOnce(response({reason:'修改',upserts:[{...nodes[2],summary}],removeIds:[]}));
 await planGuide(config,{...input,nodes});expect(JSON.stringify(fixture.invoke.mock.calls[1][0])).toContain('完整详情尚未读取');
 expect(JSON.stringify(fixture.invoke.mock.calls[2][0])).toContain('找不到当前导图节点');expect(fixture.invoke).toHaveBeenCalledTimes(4);
});
it('同轮多个只读工具都有对应回执，不能同轮查询并宣称提交成功',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});
 const mixed=new AIMessage({content:'',tool_calls:[{name:'read_reading_guide',id:'r1',args:{action:'children',nodeId:null}},{name:'update_reading_guide',id:'save',args:patch()}]});
 fixture.invoke.mockResolvedValueOnce(mixed).mockResolvedValueOnce(response(patch()));
 await planGuide(config,input);const followup=fixture.invoke.mock.calls[1][0];expect(followup.filter((m:{getType:()=>string})=>m.getType()==='tool')).toHaveLength(2);
 expect(JSON.stringify(followup)).toContain('先完成查询');
});
it('初始完整分析超预算会明确报错，不调用模型、不截取分析或自动填节点',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});
 await expect(planGuide(config,{...input,source:{...input.source,analysisText:'字'.repeat(10000)},capacity:{maxInputTokens:4096,fixedPrompt:'',toolSchema:''}})).rejects.toThrow('输入超过');
 expect(fixture.invoke).not.toHaveBeenCalled();
});

it('多轮查询按完整工具闭环淘汰历史，保留完整主分析并显式告知，不累加窗口占用',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});const node={id:'old',parentId:null,title:'旧主题',summary:'真'.repeat(6000),sourceIds:['m']};
 for(let i=0;i<10;i++)fixture.invoke.mockResolvedValueOnce(query({action:'details',nodeId:'old',summaryOffset:i*500},'r'+i));
 fixture.invoke.mockResolvedValueOnce(response(patch()));
 await planGuide(config,{...input,nodes:[node],capacity:{maxInputTokens:8192,fixedPrompt:'',toolSchema:''}});
 const final=fixture.invoke.mock.calls.at(-1)![0];expect(JSON.stringify(final)).toContain('移除');expect(JSON.stringify(final)).toContain(input.source.analysisText);
 const toolIds=new Set(final.filter((message:{getType:()=>string})=>message.getType()==='ai').flatMap((message:{tool_calls:{id:string}[]})=>message.tool_calls.map(call=>call.id)));
 for(const message of final.filter((message:{getType:()=>string})=>message.getType()==='tool'))expect(toolIds.has(message.tool_call_id)).toBe(true);
});

it('4096小窗口也先给真实工具定义和查询预留空间，再决定注入详情',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});fixture.invoke.mockResolvedValue(response(patch()));
 const capacity={maxInputTokens:4096,fixedPrompt:GUIDE_PROMPT,toolSchema:GUIDE_TOOL_SCHEMA};
 const nodes=[{id:'old',parentId:null,title:'旧主题',summary:'字'.repeat(6000),sourceIds:['m']}];
 const context=guideInitialContext({...input,nodes,capacity});expect(context.framework.budgetLimited).toBe(true);
 await planGuide(config,{...input,nodes,capacity});expect(fixture.invoke).toHaveBeenCalledOnce();
});

it('不能用new编号的命名空间碰撞绕过隐藏旧节点详情读取',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});
 const old={id:'m:new-practice',parentId:null,title:'旧主题',summary:'字'.repeat(6000),sourceIds:['m']};
 fixture.invoke.mockResolvedValueOnce(response(patch())).mockResolvedValueOnce(response({...patch(),upserts:[{...patch().upserts[0],id:'new-other'}]}));
 const result=await planGuide(config,{...input,nodes:[old]});expect(result.patch.upserts[0].id).toBe('m:new-other');
 expect(JSON.stringify(fixture.invoke.mock.calls[1][0])).toContain('冲突');
});

it('缺少调用ID时不执行工具，也不把未闭合的AI调用带进后续上下文',async()=>{
 fixture.bind.mockReturnValue({invoke:fixture.invoke});
 fixture.invoke.mockResolvedValueOnce(new AIMessage({content:'',tool_calls:[{name:'read_reading_guide',args:{action:'children',nodeId:null}}]})).mockResolvedValueOnce(response(patch()));
 await planGuide(config,input);const next=fixture.invoke.mock.calls[1][0];expect(JSON.stringify(next)).toContain('本轮未执行');
 expect(next.filter((message:{getType:()=>string})=>message.getType()==='ai')).toHaveLength(0);
});
