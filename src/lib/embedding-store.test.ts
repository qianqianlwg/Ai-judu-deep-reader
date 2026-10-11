import {afterEach,it,expect} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
type TestDb={exec(sql:string):void;close():void;prepare(sql:string):{get(...args:unknown[]):Record<string,unknown>|undefined;all(...args:unknown[]):Record<string,unknown>[];run(...args:unknown[]):unknown}};
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as {DatabaseSync:new(file:string)=>TestDb};
import {readEmbeddingConfig,saveEmbeddingConfig,ensureEmbeddingSchema,readAgentRetrievalEnabled,saveAgentRetrievalEnabled} from './embedding-store';
let directory:string|undefined;
afterEach(async()=>{if(directory){await fs.rm(directory,{recursive:true,force:true});directory=undefined;}});
it('独立存储向量密钥，不改聊天配置；增量 schema 可重复运行',()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ai_provider_configs(id TEXT PRIMARY KEY,provider TEXT,base_url TEXT,api_key TEXT,model TEXT,updated_at TEXT)');db.exec("INSERT INTO ai_provider_configs VALUES('default','openai','','chat-key','chat','')");saveEmbeddingConfig(db,{apiKey:'fake-vector-key'});expect(readEmbeddingConfig(db).apiKey).toBe('fake-vector-key');expect(db.prepare("SELECT api_key FROM ai_provider_configs WHERE id='default'").get()?.api_key).toBe('chat-key');expect(()=>saveEmbeddingConfig(db,{apiKey:'bad key'})).toThrow();ensureEmbeddingSchema(db);ensureEmbeddingSchema(db);db.close();});

it("persists custom endpoint/model/dimension and keeps vectors profiles separate",()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ai_provider_configs(id TEXT PRIMARY KEY,provider TEXT,base_url TEXT,api_key TEXT,model TEXT,updated_at TEXT)');const saved=saveEmbeddingConfig(db,{apiKey:'custom-key',baseUrl:'https://vectors.example/v1/embeddings',model:'custom-embed',dimensions:768});expect(saved).toMatchObject({apiKey:'custom-key',baseUrl:'https://vectors.example/v1',model:'custom-embed',dimensions:768});expect(readEmbeddingConfig(db)).toMatchObject(saved);saveEmbeddingConfig(db,{apiKey:'',dimensions:null});expect(readEmbeddingConfig(db)).toMatchObject({apiKey:'custom-key',dimensions:null});expect(()=>saveEmbeddingConfig(db,{baseUrl:'https://user:pass@vectors.example/v1',apiKey:'x'})).toThrow();db.close();});

it("reopens persisted semantic API, model, dimensions and retrieval consent after a process restart", async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-embedding-restart-"));
  const filename = path.join(directory, "settings.sqlite");
  let db = new DatabaseSync(filename);
  db.exec('CREATE TABLE ai_provider_configs(id TEXT PRIMARY KEY,provider TEXT,base_url TEXT,api_key TEXT,model TEXT,updated_at TEXT)');
  try {
    saveEmbeddingConfig(db, { apiKey: "restart-test-key", baseUrl: "https://custom-embedding.example/v1", model: "custom-embedding-model", dimensions: 768 });
    saveAgentRetrievalEnabled(db, true);
    db.close();
    db = new DatabaseSync(filename);
    expect(readEmbeddingConfig(db)).toMatchObject({ apiKey: "restart-test-key", baseUrl: "https://custom-embedding.example/v1", model: "custom-embedding-model", dimensions: 768 });
    expect(readAgentRetrievalEnabled(db)).toBe(true);
  } finally {
    db.close();
  }
});