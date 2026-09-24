import {EMBEDDING_MODEL,EMBEDDING_URL,type EmbeddingConfig} from './embedding-provider';
export type EmbeddingStore={exec(sql:string):void;prepare(sql:string):{get(...args:unknown[]):unknown;all(...args:unknown[]):unknown[];run(...args:unknown[]):unknown}};
export function readEmbeddingConfig(db:EmbeddingStore):EmbeddingConfig{
 const row=db.prepare("SELECT api_key FROM ai_provider_configs WHERE id = ?").get('embedding');
 return {apiKey:row&&typeof row==='object'&&'api_key' in row&&typeof row.api_key==='string'?row.api_key:process.env.SILICONFLOW_API_KEY??''};
}
export function saveEmbeddingConfig(db:EmbeddingStore,apiKey:unknown):void{
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>500||/\s/u.test(apiKey.trim()))throw new Error('请输入有效的向量模型 API Key');
 db.prepare('INSERT INTO ai_provider_configs (id,provider,base_url,api_key,model,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key,model=excluded.model,base_url=excluded.base_url,updated_at=excluded.updated_at').run('embedding','openai',EMBEDDING_URL,apiKey.trim(),EMBEDDING_MODEL,new Date().toISOString());
}
export function ensureEmbeddingSchema(db:EmbeddingStore):void{
 // WHY：同步 schema 及短事务仅用于本地 SQLite；网络 IO 必须在事务外 await，避免锁住书库。
 db.exec(`CREATE TABLE IF NOT EXISTS paragraph_embeddings(edition_id TEXT NOT NULL,paragraph_id TEXT NOT NULL,chunk_start INTEGER NOT NULL,chunk_end INTEGER NOT NULL,text_hash TEXT NOT NULL,profile TEXT NOT NULL,vector_json TEXT NOT NULL,PRIMARY KEY(edition_id,paragraph_id,chunk_start,profile));
 CREATE TABLE IF NOT EXISTS embedding_preferences(id INTEGER PRIMARY KEY CHECK(id=1),agent_semantic INTEGER NOT NULL CHECK(agent_semantic IN (0,1)));
 CREATE TABLE IF NOT EXISTS embedding_build_leases(edition_id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
}

export function readAgentRetrievalEnabled(db:EmbeddingStore):boolean {
 ensureEmbeddingSchema(db);
 const row=db.prepare("SELECT agent_semantic FROM embedding_preferences WHERE id=1").get();
 return !(row&&typeof row==="object"&&"agent_semantic" in row&&row.agent_semantic===0);
}
export function saveAgentRetrievalEnabled(db:EmbeddingStore,value:unknown):void {
 if(typeof value!=="boolean")throw new Error("自动检索设置必须是布尔值");
 ensureEmbeddingSchema(db);db.prepare("INSERT INTO embedding_preferences(id,agent_semantic) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET agent_semantic=excluded.agent_semantic").run(value?1:0);
}
