import {NextRequest} from 'next/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {getDb} from '@/lib/db';
import {isSemanticReading,type SemanticReading} from '@/lib/semantic-reading';
import {restoreReadingRequest} from '@/lib/reading-request';
import {hydrateChatHistory} from '@/lib/chat-history';
type Db=ReturnType<typeof getDb>;
const fixture=vi.hoisted(()=>({db:undefined as Db|undefined}));
vi.mock('@/lib/db',()=>({getDb:()=>{if(!fixture.db)throw new Error('未初始化');return fixture.db;}}));
import {POST} from './route';
const runtime=(process as unknown as {getBuiltinModule(name:string):{DatabaseSync:new(file:string)=>Db}}).getBuiltinModule('node:sqlite');
const fetcher=vi.fn<typeof fetch>(),encoder=new TextEncoder();
const texts=['这是第一个完整意思。','这是第二个完整意思。','图一。'],original=texts.join('');
const payload={threadId:'thread-semantic',clientUserMessageId:'user-semantic',clientAssistantMessageId:'parent-semantic',editionId:'edition-1',bookId:'book-1',chapterId:'chapter-1',paragraphId:'p1',mode:'analyze',readingStyle:'semantic',question:'请按句意细读',selectedText:original,selectionStart:0,selectionEnd:original.length,selectionAnchors:[{paragraphId:'p1',startOffset:0,endOffset:original.length,selectedText:original}]};
function upstream(content?:string,args?:unknown){const data=args?{id:'step',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-plan',type:'function',function:{name:'plan_reading_units',arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]}:{id:'step',choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]};return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode('data: '+JSON.stringify(data)+String.fromCharCode(10,10)+'data: [DONE]'+String.fromCharCode(10,10)));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const plan=(allSkip=false)=>({units:texts.map((text,i)=>({label:'意思'+(i+1),action:allSkip||i===2?'skip':'read',reason:allSkip||i===2?'原文直白无需额外解释':'',fragments:[{paragraphId:'p1',text}]}))});
async function call(extra:Record<string,unknown>={}){const response=await POST(new NextRequest('http://localhost/api/analyze/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...extra})}));return {status:response.status,text:await response.text()};}
function parent(){return fixture.db!.prepare('SELECT * FROM chat_messages WHERE id=?').get(payload.clientAssistantMessageId) as {id:string;role:'assistant';content:string;status:string;structured_output:string};}
function state():SemanticReading {const v:unknown=JSON.parse(parent().structured_output).semantic;if(!isSemanticReading(v))throw new Error('状态缺失');return v;}
beforeEach(()=>{fixture.db=new runtime.DatabaseSync(':memory:');fixture.db.exec(String.raw`
    CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT);
    INSERT INTO ai_provider_configs VALUES ('default', 'openai', 'https://provider.test', 'test-key', 'test-model');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT, usage_json TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);
    CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT, book_id TEXT, edition_id TEXT, summary TEXT, recent_messages TEXT, token_count INTEGER, version INTEGER, created_at TEXT, checkpoint_json TEXT);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT, order_index INTEGER);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, order_index INTEGER);
    INSERT INTO chapters VALUES ('chapter-1', 'edition-1', '导论', 0), ('chapter-2', 'edition-2', '另一版', 0);
    INSERT INTO paragraphs VALUES ('p1', 'chapter-1', '前言这是十字原文用来句读后文', 0), ('p2', 'chapter-2', '前言这是十字原文用来句读后文', 0);

 CREATE TABLE editions(id TEXT PRIMARY KEY,book_id TEXT,file_type TEXT);
 INSERT INTO editions VALUES('edition-1','book-1','.epub'),('edition-2','book-2','.epub');
 CREATE TABLE annotations(id TEXT PRIMARY KEY,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER,text_hash TEXT,thread_id TEXT,summary TEXT,concepts TEXT,created_at TEXT,concept_details TEXT,message_id TEXT);
`);fixture.db.prepare('UPDATE paragraphs SET text=? WHERE id=?').run(original,'p1');fetcher.mockReset();vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();fixture.db?.close();fixture.db=undefined;});
describe('按句意细读 API 集成',()=>{
 it('真实模型工具协议、独立原文锚点、事务标注、历史合组和幂等回放',async()=>{
  fetcher.mockResolvedValueOnce(upstream(undefined,plan())).mockResolvedValueOnce(upstream('第一块解释。')).mockResolvedValueOnce(upstream('第二块解释。'));
  const response=await call();expect(response.status).toBe(200);expect(response.text).toContain('event: semantic');expect(response.text).toContain('event: done');
  expect(state().units.map(u=>u.status)).toEqual(['completed','completed','skipped']);
  const rows=fixture.db!.prepare('SELECT * FROM annotations ORDER BY start_offset').all() as {start_offset:number;end_offset:number;message_id:string}[];expect(rows.map(r=>[r.start_offset,r.end_offset])).toEqual([[0,texts[0].length],[texts[0].length,texts[0].length+texts[1].length]]);expect(new Set(rows.map(r=>r.message_id)).size).toBe(2);
  const history=fixture.db!.prepare('SELECT id,role,content,status,structured_output AS structuredOutput FROM chat_messages ORDER BY created_at').all() as Parameters<typeof hydrateChatHistory>[0];const hydrated=hydrateChatHistory(history);expect(hydrated).toHaveLength(2);expect(hydrated.find(m=>m.id===payload.clientAssistantMessageId)?.semantic?.units).toHaveLength(3);
  const count=fetcher.mock.calls.length;expect((await call()).text).toContain('event: semantic');expect(fetcher).toHaveBeenCalledTimes(count);
 });
 it('一块失败后刷新恢复只继续未完成块，不重新规划',async()=>{
  fetcher.mockResolvedValueOnce(upstream(undefined,plan())).mockResolvedValueOnce(upstream('第一块解释。')).mockRejectedValueOnce(new Error('网络中断'));
  expect((await call()).text).toContain('event: error');expect(state().units[0].status).toBe('completed');
  const stored=parent(),restored=restoreReadingRequest(payload.threadId,{...stored,structuredOutput:stored.structured_output});expect(restored?.payload.readingStyle).toBe('semantic');expect(restored?.semantic?.units[0].status).toBe('completed');
  fetcher.mockResolvedValueOnce(upstream('第二块恢复。'));expect((await call()).text).toContain('event: done');expect(fetcher).toHaveBeenCalledTimes(4);expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:2});
 });
 it('全略过也有明确原因和可恢复来源，不创建伪解释标注',async()=>{fetcher.mockResolvedValueOnce(upstream(undefined,plan(true)));const r=await call();expect(r.text).toContain('event: done');expect(state().units.every(u=>u.status==='skipped')).toBe(true);expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:0});expect(fetcher).toHaveBeenCalledOnce();});
 it('错误分块有限修正，不用普通回答冒充成功',async()=>{for(let i=0;i<3;i++)fetcher.mockResolvedValueOnce(upstream(undefined,{units:plan().units.slice(0,1)}));expect((await call()).text).toContain('event: error');expect(state().units).toHaveLength(0);expect(fetcher).toHaveBeenCalledTimes(3);});
 it('损坏的分块数组在SSE明确报告，不让历史标记冒充新结果',async()=>{for(let i=0;i<3;i++)fetcher.mockResolvedValueOnce(upstream(undefined,{units:'broken'}));const response=await call();expect(response.text).toContain('semantic_plan_invalid');expect(response.text).toContain('原有句读线不是本次结果');expect(state().units).toHaveLength(0);expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:0});});
 it('整段模式同样交给Agent规划，恢复保留模式与小白设置',async()=>{fetcher.mockResolvedValueOnce(upstream(undefined,plan(true)));const response=await call({readingStyle:'whole',difficulty:'beginner'});expect(response.text).toContain('event: done');expect(state().readingStyle).toBe('whole');const outgoing=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(outgoing.messages.at(-1).content).toContain('whole');expect(outgoing.tools[0].function.description).toContain('以自然段为最小单位');const stored=parent(),restored=restoreReadingRequest(payload.threadId,{...stored,structuredOutput:stored.structured_output});expect(restored?.payload).toMatchObject({readingStyle:'whole',difficulty:'beginner'});});
 it('跨版本或伪造来源在调用模型前拒绝',async()=>{expect((await call({selectedText:'伪造文字'})).status).toBe(409);expect((await call({sectionId:'chapter-2'})).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
 it('本节原文由服务端解析，不信任浏览器提交的正文',async()=>{fetcher.mockResolvedValueOnce(upstream(undefined,plan(true)));const r=await call({sectionId:'chapter-1',selectedText:'浏览器伪造正文'});expect(r.text).toContain('event: done');expect(state().units[0].anchor.selectedText).toBe(texts[0]);expect(JSON.stringify(JSON.parse(String(fetcher.mock.calls[0][1]?.body)))).not.toContain('浏览器伪造正文');});
});
