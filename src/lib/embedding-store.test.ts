import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
type TestDb={exec(sql:string):void;close():void;prepare(sql:string):{get(...args:unknown[]):Record<string,unknown>|undefined;all(...args:unknown[]):Record<string,unknown>[];run(...args:unknown[]):unknown}};
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as {DatabaseSync:new(file:string)=>TestDb};
import {readEmbeddingConfig,saveEmbeddingConfig,ensureEmbeddingSchema} from './embedding-store';
it('独立存储向量密钥，不改聊天配置；增量 schema 可重复运行',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ai_provider_configs(id TEXT PRIMARY KEY,provider TEXT,base_url TEXT,api_key TEXT,model TEXT,updated_at TEXT)');db.exec("INSERT INTO ai_provider_configs VALUES('default','openai','','chat-key','chat','')");saveEmbeddingConfig(db,'fake-vector-key');expect(readEmbeddingConfig(db).apiKey).toBe('fake-vector-key');expect(db.prepare("SELECT api_key FROM ai_provider_configs WHERE id='default'").get()?.api_key).toBe('chat-key');expect(()=>saveEmbeddingConfig(db,'bad key')).toThrow();ensureEmbeddingSchema(db);ensureEmbeddingSchema(db);db.close();});
