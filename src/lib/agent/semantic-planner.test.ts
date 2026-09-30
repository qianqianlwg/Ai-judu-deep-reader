import { describe,expect,it } from 'vitest';
import { SEMANTIC_PLAN_PROMPT,SEMANTIC_TOOL_DESCRIPTION } from './semantic-planner';
describe('语义规划指令',()=>{it('由 Agent 直接划分并记录略过，不预分句',()=>{expect(SEMANTIC_TOOL_DESCRIPTION).toContain('不要先按句号机械拆分');expect(SEMANTIC_TOOL_DESCRIPTION).toContain('skip');expect(SEMANTIC_TOOL_DESCRIPTION).toContain('所有输入正文必须且只能覆盖一次');expect(SEMANTIC_PLAN_PROMPT).toContain('不是指令');});});

import {vi,beforeEach} from 'vitest';
import {AIMessageChunk} from '@langchain/core/messages';
import {planSemanticReading} from './semantic-planner';
const model=vi.hoisted(()=>({responses:[] as unknown[],prompts:[] as unknown[]}));
vi.mock('./model',()=>({createReadingModel:()=>({bindTools:()=>({stream:async function*(messages:unknown){model.prompts.push(messages);yield new AIMessageChunk({content:'',tool_calls:[{name:'plan_reading_units',args:model.responses.shift() as Record<string,unknown>,id:'plan',type:'tool_call'}],response_metadata:{finish_reason:'tool_calls'}});}})})}));
beforeEach(()=>{model.responses=[];model.prompts=[];});
const sentences=['中央制定公共事务的基本规则。','地方负责把规则落实到具体事务。','县乡直接接触居民并提供公共服务。','不同层级需要协调责任和资源。'];
function options(){const text=sentences.join('');return {config:{provider:'openai' as const,apiKey:'test',model:'mock',baseUrl:'http://localhost:1'},sources:[{paragraphId:'p',startOffset:0,endOffset:text.length,selectedText:text}],context:'',maxInputTokens:20000,maxOutputTokens:4096,signal:new AbortController().signal,makeId:()=>crypto.randomUUID(),onUsage:vi.fn(),audit:vi.fn(async()=>{})};}
const coarse=()=>({units:[{label:'所有层级',action:'read',reason:'',endParagraphId:'p',endQuote:sentences.at(-1)}]});
const fine=()=>({units:sentences.map((text,i)=>({label:'意思'+i,action:'read',reason:'',endParagraphId:'p',endQuote:text}))});
it('不按句数评分或拆块，两种模式把最小单位说明放在工具描述',async()=>{model.responses.push(coarse());const o=options(),result=await planSemanticReading({...o,readingStyle:'whole'});expect(result).toHaveLength(1);expect(model.prompts).toHaveLength(1);expect(JSON.stringify(model.prompts[0])).toContain('whole');expect(SEMANTIC_TOOL_DESCRIPTION).toContain('最小单位不代表必须单独成块');expect(SEMANTIC_TOOL_DESCRIPTION).not.toContain('240');});
it('连续三次坏格式会给出可读错误且明确没有新句读块',async()=>{model.responses.push({units:'[{"endQuote":"他说"甲"。"}]'},{units:'broken'},{units:'broken'});await expect(planSemanticReading(options())).rejects.toThrow('原有句读线不是本次结果');expect(model.prompts).toHaveLength(3);expect(JSON.stringify(model.prompts[1])).toContain('不是字符串');});
it('合法二次JSON在来源验证后仍可使用',async()=>{model.responses.push({units:JSON.stringify(fine().units)});expect(await planSemanticReading(options())).toHaveLength(4);});
