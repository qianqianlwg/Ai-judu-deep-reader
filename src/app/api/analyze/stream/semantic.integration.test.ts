import { SOURCE_EMPHASIS_SCHEMA } from '@/lib/source-enhancement-store';
import { GUIDE_SCHEMA } from "@/lib/guide-schema";
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
function submission(text:string,title='商品关系') {return {listTitle:'原文逐句细读',sourceStart:Array.from(text).slice(0,5).join(''),sourceEnd:Array.from(text).slice(-5).join(''),title,content:'这一句说明了对应的关系。',keywords:'无',keySentences:'无',concepts:'无',answerEmphasis:'无'};}
function upstream(args:unknown){const chunks=[{choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:crypto.randomUUID(),type:'function',function:{name:'submit_reading_sentence',arguments:''}}]},finish_reason:null}]},{choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:JSON.stringify(args)}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:20000,completion_tokens:18000,total_tokens:38000}}];return new Response(new ReadableStream<Uint8Array>({start(c){for(const part of chunks)c.enqueue(encoder.encode('data: '+JSON.stringify(part)+'\n\n'));c.enqueue(encoder.encode('data: [DONE]\n\n'));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
async function call(extra:Record<string,unknown>={}){const response=await POST(new NextRequest('http://localhost/api/analyze/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...extra})}));return {status:response.status,text:await response.text()};}
function parent(){return fixture.db!.prepare('SELECT * FROM chat_messages WHERE id=?').get(payload.clientAssistantMessageId) as {id:string;role:'assistant';content:string;status:string;structured_output:string};}
function state():SemanticReading {const v:unknown=JSON.parse(parent().structured_output).semantic;if(!isSemanticReading(v))throw new Error('状态缺失');return v;}
beforeEach(()=>{fixture.db=new runtime.DatabaseSync(':memory:');fixture.db.exec(GUIDE_SCHEMA);fixture.db.exec(SOURCE_EMPHASIS_SCHEMA);fixture.db.exec(String.raw`
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
describe('逐句增量细读 API 集成',()=>{
 it('第二句请求仍在等待时，浏览器已收到首句事件且标注已保存',async()=>{
  let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});
  fetcher.mockResolvedValueOnce(upstream(submission(texts[0]))).mockImplementationOnce(async()=>{await wait;return upstream(submission(texts[1]));}).mockResolvedValueOnce(upstream(submission(texts[2])));
  const response=await POST(new NextRequest('http://localhost/api/analyze/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
  const reader=response.body!.getReader(),decoder=new TextDecoder();let received='';
  try{
   while(!received.includes('"status":"completed"')){const part=await reader.read();if(part.done)throw new Error('首句前流中断');received+=decoder.decode(part.value,{stream:true});}
   expect(received).not.toContain('event: done');expect(state().units).toHaveLength(1);expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:1});
  }finally{release();while(!(await reader.read()).done){/* WHY：释放受控上游并消费尾流，让测试不留下悬挂的数据库操作。 */}}
 });
 it('单工具逐句提交、事务标注、进度、历史合组及幂等回放；累计预算不会截断',async()=>{
  for(const text of texts)fetcher.mockResolvedValueOnce(upstream(submission(text)));
  const response=await call();expect(response.status).toBe(200);expect(response.text).toContain('event: done');
  const events=response.text.split('\n\n').filter(b=>b.startsWith('event: semantic')).map(b=>JSON.parse(b.split('\ndata: ')[1]).result as SemanticReading);
  expect(events[0]).toMatchObject({phase:'planning',thinkingCompleted:false,totalCharacters:original.length});
  expect(events.some(s=>s.thinkingCompleted&&s.units.length===0&&s.pending?.index===1)).toBe(true);
  expect(events.some(s=>s.phase==='reading'&&s.units.length===1)).toBe(true);
  expect(state().units.map(u=>u.status)).toEqual(['completed','completed','completed']);
  expect(state().title).toBe('原文逐句细读');
  const rows=fixture.db!.prepare('SELECT * FROM annotations ORDER BY start_offset').all() as {start_offset:number;end_offset:number;message_id:string}[];
  expect(rows).toHaveLength(3);expect(rows[0]).toMatchObject({start_offset:0,end_offset:texts[0].length});
  const history=fixture.db!.prepare('SELECT id,role,content,status,structured_output AS structuredOutput FROM chat_messages ORDER BY created_at').all() as Parameters<typeof hydrateChatHistory>[0];
  expect(hydrateChatHistory(history)).toHaveLength(2);
  for(const outgoing of fetcher.mock.calls){const request=JSON.parse(String(outgoing[1]?.body));expect(request.tools).toHaveLength(1);expect(request.tools[0].function.name).toBe('submit_reading_sentence');expect(request.max_tokens).toBeUndefined();expect(request.max_completion_tokens).toBeUndefined();}
  const count=fetcher.mock.calls.length;await call();expect(fetcher).toHaveBeenCalledTimes(count);
 });
 it('第二句失败时首句和标注已持久化，恢复仅继续剩余原文',async()=>{
  fetcher.mockResolvedValueOnce(upstream(submission(texts[0]))).mockRejectedValueOnce(new Error('网络中断'));
  expect((await call()).text).toContain('event: error');expect(state().phase).toBe('interrupted');expect(state().units).toHaveLength(1);
  const stored=parent(),restored=restoreReadingRequest(payload.threadId,{...stored,structuredOutput:stored.structured_output});expect(restored?.semantic?.units[0].status).toBe('completed');
  fetcher.mockResolvedValueOnce(upstream(submission(texts[1]))).mockResolvedValueOnce(upstream(submission(texts[2])));
  expect((await call()).text).toContain('event: done');expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:3});expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('错误首尾定位反馈给Agent修正，既不伪造结果也不重做首句',async()=>{
  fetcher.mockResolvedValueOnce(upstream(submission(texts[0]))).mockResolvedValueOnce(upstream({...submission(texts[1]),sourceEnd:'找不到尾。'})).mockResolvedValueOnce(upstream(submission(texts[1]))).mockResolvedValueOnce(upstream(submission(texts[2])));
  const r=await call();expect(r.text).toContain('找不到对应语句');expect(r.text).toContain('event: done');expect(state().units).toHaveLength(3);expect(JSON.stringify(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).messages)).toContain('找不到对应语句');
 });
 it('省略必填标注三次失败报告明确错误，不添加新句读标记',async()=>{
  for(let i=0;i<3;i++)fetcher.mockResolvedValueOnce(upstream({...submission(texts[0]),keywords:undefined}));
  const r=await call();expect(r.text).toContain('event: error');expect(r.text).toContain('必填');expect(state().units).toHaveLength(0);expect(fixture.db!.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:0});
 });
 it('每句Agent原文关键词和关键句通过工具同步保存',async()=>{
  fetcher.mockResolvedValueOnce(upstream({...submission(texts[0]),keywords:[{paragraphId:'p1',quote:'完整意思',occurrence:1}]}));
  for(const t of texts.slice(1))fetcher.mockResolvedValueOnce(upstream(submission(t)));
  expect((await call()).text).toContain('event: done');expect(state().units[0].sourceEmphasis?.[0]).toMatchObject({quote:'完整意思',kind:'term'});
  expect(fixture.db!.prepare('SELECT count(*) AS n FROM source_emphasis').get()).toEqual({n:1});
 });
 it('whole模式保留自然段最小单位说明，不在程序预切句',async()=>{
  fetcher.mockResolvedValueOnce(upstream(submission(original)));
  const r=await call({readingStyle:'whole',difficulty:'beginner'});expect(r.text).toContain('event: done');expect(state().units).toHaveLength(1);expect(JSON.stringify(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages)).toContain('以自然段为最小单位');
 });
 it('跨版本和伪造选文在模型调用前拒绝；本节来源由服务端解析',async()=>{
  expect((await call({selectedText:'伪造文字'})).status).toBe(409);expect((await call({sectionId:'chapter-2'})).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(upstream(submission(original)));expect((await call({sectionId:'chapter-1',selectedText:'浏览器伪造正文'})).text).toContain('event: done');expect(state().units[0].anchor.selectedText).toBe(original);
 });
 it('上游错误可见，换模型重试沿用原选文和父消息',async()=>{
  fixture.db!.exec("CREATE TABLE ai_model_choices(model TEXT PRIMARY KEY,position INTEGER);INSERT INTO ai_model_choices VALUES('new-model',0)");
  fetcher.mockResolvedValueOnce(Response.json({error:{message:'没有可用渠道',code:'channel_unavailable'}},{status:403}));
  expect((await call()).text).toContain('没有可用渠道');const before=JSON.parse(parent().structured_output)._request;
  for(const t of texts)fetcher.mockResolvedValueOnce(upstream(submission(t)));
  expect((await call({retryModel:'new-model'})).text).toContain('event: done');expect(fetcher.mock.calls.slice(1).map(c=>JSON.parse(String(c[1]?.body)).model)).toEqual(['new-model','new-model','new-model']);
  expect(JSON.parse(parent().structured_output)._request).toMatchObject({fingerprint:before.fingerprint,input:before.input,executionModel:'new-model'});
  expect(fixture.db!.prepare("SELECT count(*) AS n FROM chat_messages WHERE role='user'").get()).toEqual({n:1});
 });
});
