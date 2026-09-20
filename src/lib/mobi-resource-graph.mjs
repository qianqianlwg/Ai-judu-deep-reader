// @ts-check
import {createHash} from 'node:crypto';
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutResource} Resource */
/** @typedef {'image'|'style'|'css'|'media'} Role */
/** @typedef {{id:string;fragment:string}|{blocked:string}} Reference */
/** @typedef {(value:string,role:Role)=>Promise<string|null>} Resolve */
/** @typedef {(resource:Resource,resolve:Resolve)=>Promise<Uint8Array>} Transform */
/** @typedef {{id:string;mediaType:string;bytes:Uint8Array;sourceHash:string;outputHash:string}} Processed */
const MAX_BYTES=100*1024*1024,MAX_FILES=5000,MAX_EDGES=20000,MAX_DEPTH=16;
const ID=/^mobi-resource-v1\/[A-Za-z0-9_-]+\.[a-z0-9]+$/u;
const IMAGES=new Set(['image/jpeg','image/png','image/gif','image/bmp','image/svg+xml']);
const FONTS=new Set(['font/ttf','font/otf','font/woff','font/woff2','application/vnd.ms-fontobject']);
const MEDIA=new Set(['audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm','video/x-matroska']);
const hash=(/** @type {Uint8Array} */ bytes)=>createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value @returns {value is string} */
function id(value){return typeof value==='string'&&value.length<=512&&ID.exec(value)?.[0]===value;}
/** @param {string} type @param {Role} role */
function permitted(type,role){return role==='style'?type==='text/css':role==='image'?IMAGES.has(type):role==='media'?MEDIA.has(type):IMAGES.has(type)||FONTS.has(type);}
/**
 * 只解析包内受控命名，不使用网络URL或文件系统路径解析器；结果不是资源安全证明。
 * @param {string} value @param {string|null} base @returns {Reference}
 */
export function resolveMobiResourceReference(value,base=null){
 if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u0020\u007f\\]/u.test(value))return {blocked:'invalid-reference'};
 const split=value.indexOf('#'),path=split<0?value:value.slice(0,split),rawFragment=split<0?'':value.slice(split+1);
 let decoded='',fragment='';
 try{decoded=decodeURIComponent(path);fragment=decodeURIComponent(rawFragment);}catch(cause){if(cause instanceof URIError)return {blocked:'invalid-encoding'};throw cause;}
 if(fragment.length>1024||/[\u0000-\u001f\u007f]/u.test(fragment))return {blocked:'invalid-fragment'};
 const suffix=fragment?'#'+encodeURIComponent(fragment):'';
 if(!path)return suffix?{id:'',fragment:suffix}:{blocked:'empty-reference'};
 if(/[\u0000-\u0020\u007f\\?:%]/u.test(decoded)||decoded.startsWith('/'))return {blocked:'external-or-unsafe-path'};
 if(ID.exec(decoded)?.[0]===decoded)return {id:decoded,fragment:suffix};
 if(!base||!id(base))return {blocked:'relative-without-origin'};
 const local=decoded.startsWith('./')?decoded.slice(2):decoded;
 if(local.includes('/')||local==='.'||local==='..')return {blocked:'path-traversal'};
 const candidate='mobi-resource-v1/'+local;
 return id(candidate)?{id:candidate,fragment:suffix}:{blocked:'invalid-package-path'};
}
/**
 * 有界资源依赖图。转换器由组合根明确注入：本模块不解码图片、不净化HTML/CSS，不可单独当作可发布证明。
 * 缺失本地资源/角色错配/循环/超预算会失败；外部及不安全引用返回null并留下诊断。
 * @param {readonly Resource[]} resources
 */
export function createMobiResourceGraph(resources){
 if(!Array.isArray(resources)||resources.length>MAX_FILES)throw new Error('MOBI资源图数量无效');
 let inputBytes=0;
 /** @type {Map<string,Resource>} */ const inputs=new Map();
 // WHY：先逐项验证累计预算再复制，避免为最终必拒绝的输入分配大副本。
 for(const resource of resources){if(!resource||!id(resource.id)||typeof resource.mediaType!=='string'||resource.mediaType.length>128||!(resource.bytes instanceof Uint8Array)||!resource.bytes.length||inputs.has(resource.id))throw new Error('MOBI资源图条目无效');inputBytes+=resource.bytes.length;if(inputBytes>MAX_BYTES)throw new Error('MOBI资源图字节超限');inputs.set(resource.id,resource);}
 for(const [key,resource]of inputs)inputs.set(key,{...resource,bytes:new Uint8Array(resource.bytes)});
 return {
  /** @param {readonly {ref:string;role:Role}[]} roots @param {Transform} transform */
  async process(roots,transform){
   if(!Array.isArray(roots)||roots.length>MAX_EDGES||typeof transform!=='function')throw new Error('MOBI资源图入口无效');
   /** @type {Map<string,Promise<Processed>>} */const jobs=new Map();
   /** @type {Map<string,Set<string>>} */const edges=new Map();
   /** @type {Map<string,number>} */const longestDepth=new Map();
   /** @type {{base:string|null;value:string;reason:string}[]} */const diagnostics=[];
   let requests=0,edgeCount=0,searches=0,depthSearches=0,outputBytes=0;
   /** @param {string} start @param {number} depth */
   function propagateDepth(start,depth){
    const pending=[{id:start,depth}];
    while(pending.length){
     if(++depthSearches>2_000_000)throw new Error('MOBI资源图深度遍历超限');
     const current=pending.pop();
     if(!current)continue;
     if(current.depth>MAX_DEPTH)throw new Error('MOBI资源图深度超限');
     if(current.depth<=(longestDepth.get(current.id)??-1))continue;
     longestDepth.set(current.id,current.depth);
     for(const target of edges.get(current.id)??[])pending.push({id:target,depth:current.depth+1});
    }
   }
   /** @param {string} from @param {string} to */
   function edge(from,to){
    const adjacent=edges.get(from)??new Set();if(adjacent.has(to))return;
    if(++edgeCount>MAX_EDGES)throw new Error('MOBI资源图边数超限');
    // WHY：仅检查递归parents无法发现并发B→C/C→B互等；先登记并检验整张已知依赖图，再等待缓存任务。
    const pending=[to],seen=new Set();
    while(pending.length){if(++searches>2_000_000)throw new Error('MOBI资源图遍历超限');const current=pending.pop();if(current===from)throw new Error('MOBI资源图循环引用');if(!current||seen.has(current))continue;seen.add(current);pending.push(...(edges.get(current)??[]));}
    const sourceDepth=longestDepth.get(from);
    if(sourceDepth===undefined)throw new Error('MOBI资源图深度状态无效');
    adjacent.add(to);edges.set(from,adjacent);
    propagateDepth(to,sourceDepth+1);
   }
   /** @param {string} value @param {Role} role @param {string|null} base @param {number} depth @returns {Promise<string|null>} */
   async function resolve(value,role,base,depth){
    if(++requests>MAX_EDGES)throw new Error('MOBI资源图引用次数超限');
    if(!['image','style','css','media'].includes(role))throw new Error('MOBI资源图角色无效');
    const reference=resolveMobiResourceReference(value,base);
    if('blocked' in reference){diagnostics.push({base,value:typeof value==='string'?value.slice(0,4096):'',reason:reference.blocked});return null;}
    if(!reference.id){if(role==='style'||role==='media'){diagnostics.push({base,value,reason:'fragment-role-mismatch'});return null;}return reference.fragment;}
    const resource=inputs.get(reference.id);if(!resource)throw new Error('MOBI资源图缺少本地资源：'+reference.id);
    if(!permitted(resource.mediaType,role))throw new Error('MOBI资源图角色与类型不符：'+reference.id);
    if(depth>MAX_DEPTH)throw new Error('MOBI资源图深度超限');
    if(base)edge(base,reference.id);else propagateDepth(reference.id,0);
    let job=jobs.get(reference.id);
    if(!job){
     // WHY：先缓存任务再启动异步转换，重复/菱形依赖只转换一次；失败清楚上抛，不发布半份图。
     job=Promise.resolve().then(async()=>{
      const sourceHash=hash(resource.bytes),bytes=await transform({...resource,bytes:new Uint8Array(resource.bytes)},(next,nextRole)=>resolve(next,nextRole,resource.id,depth+1));
      if(!(bytes instanceof Uint8Array)||bytes.length>MAX_BYTES)throw new Error('MOBI资源转换输出无效或超限');
      outputBytes+=bytes.length;if(outputBytes>MAX_BYTES)throw new Error('MOBI资源图输出字节超限');
      const copy=new Uint8Array(bytes);return {id:resource.id,mediaType:resource.mediaType,bytes:copy,sourceHash,outputHash:hash(copy)};
     });jobs.set(reference.id,job);
    }
    await job;return reference.id+reference.fragment;
   }
   /** @type {(string|null)[]} */const references=[];
   try{for(const root of roots){if(!root||typeof root.ref!=='string')throw new Error('MOBI资源图入口条目无效');references.push(await resolve(root.ref,root.role,null,0));}}
   catch(cause){await Promise.allSettled(jobs.values());throw cause;}
   const output=await Promise.all(jobs.values());output.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
   return {resources:output,references,diagnostics,edges:[...edges].flatMap(([from,targets])=>[...targets].map(to=>({from,to})))};
  }
 };
}
