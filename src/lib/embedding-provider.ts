export const EMBEDDING_MODEL='Qwen/Qwen3-Embedding-8B';
export const EMBEDDING_URL='https://api.siliconflow.cn/v1/embeddings';
export const EMBEDDING_DIMENSIONS=1024;
// WHY：模型、维度、切块协议一起标识向量空间，绝不把不同模型的向量混合比较。
export const EMBEDDING_PROFILE=EMBEDDING_URL+'|'+EMBEDDING_MODEL+'|1024|chunks-v1';
export type EmbeddingConfig={apiKey:string};
export class EmbeddingError extends Error {}
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object';}
export function validateVector(value:unknown,dimensions=EMBEDDING_DIMENSIONS):number[]{
 if(!Array.isArray(value)||value.length!==dimensions||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))throw new EmbeddingError('向量服务返回了无效的维度或数值');
 return value as number[];
}
export async function embedTexts(config:EmbeddingConfig,texts:readonly string[],signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<number[][]>{
 if(!config.apiKey.trim())throw new EmbeddingError('请先在设置中保存向量模型 API Key');
 if(!texts.length||texts.length>32||texts.some(text=>!text.trim()||Array.from(text).length>6000))throw new EmbeddingError('向量输入长度或批量数量不合法');
 const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
 try{
  const response=await fetcher(EMBEDDING_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify({model:EMBEDDING_MODEL,input:texts,encoding_format:'float',dimensions:EMBEDDING_DIMENSIONS}),signal:abort});
  if(!response.ok){await response.body?.cancel();throw new EmbeddingError('向量服务返回 HTTP '+response.status+'，请检查密钥、额度或稍后重试');}
  const body:unknown=await response.json();
  if(!record(body)||!Array.isArray(body.data)||body.data.length!==texts.length)throw new EmbeddingError('向量服务返回的条数不匹配');
  const result=new Map<number,number[]>();
  for(const item of body.data){if(!record(item)||!Number.isInteger(item.index)||Number(item.index)<0||Number(item.index)>=texts.length||result.has(Number(item.index)))throw new EmbeddingError('向量服务返回了无效序号');result.set(Number(item.index),validateVector(item.embedding));}
  return texts.map((_,i)=>result.get(i)!);
 }catch(error:unknown){
  if(error instanceof EmbeddingError)throw error;
  // WHY：上游异常可能回显鉴权信息和书籍正文；日志、客户端只暴露固定错误，不回显原始响应。
  console.error('向量请求失败',{name:error instanceof Error?error.name:'UnknownError'});
  throw new EmbeddingError(signal?.aborted?'向量请求已取消':'向量服务连接失败或超时，请稍后重试');
 }
}
