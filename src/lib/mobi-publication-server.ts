import {createHash} from "node:crypto";
import {prepareMobiFileLayout} from "./mobi-layout";
import {mobiSourceHref} from "./mobi-format";
import {readMobiPreparedLayout, type MobiPreparedLayout} from "./mobi-prepared-layout";
import {sanitizeMobiDocument, type MobiResourceRole} from "./mobi-document-sanitizer.mjs";
import {parseMobiSanitizerTree} from "./mobi-sanitizer-tree.mjs";
import {sanitizeMobiCss} from "./mobi-css-sanitizer.mjs";
import {createMobiResourceGraph, isMobiResourceRoleAllowed, resolveMobiResourceReference} from "./mobi-resource-graph.mjs";
import {validateMobiBinaryResource} from "./mobi-binary-resource";
import {readMobiPublication, type MobiPublication} from "./mobi-publication-model";
const digest=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const text=(value:Uint8Array)=>new TextDecoder("utf-8",{fatal:true}).decode(value);
const supported=new Set(["text/css","image/svg+xml","image/jpeg","image/png","image/gif"]);
export async function publishMobiFile(bytes:Uint8Array):Promise<MobiPublication>{return publishMobiLayout(await prepareMobiFileLayout(bytes));}
/** 组合根：仅发布可达、已净化的文本资源和真解码通过的图片，绝不公开untrusted快照。 */
export async function publishMobiLayout(input:MobiPreparedLayout):Promise<MobiPublication>{
 const prepared=readMobiPreparedLayout(input),{snapshot}=prepared;
 const manifest=new Map(snapshot.resources.map(r=>[r.id,r])),nav=new Map(prepared.navigation.map(n=>[n.href,n]));
 const roots:{ref:string;role:Exclude<MobiResourceRole,"navigation">}[]=[],dropped=new Set<string>();
 const accept=(value:string,role:Exclude<MobiResourceRole,"navigation">,base:string|null=null):string|null=>{
  const ref=resolveMobiResourceReference(value,base);
  if("blocked"in ref)return null;
  if(!ref.id)return role==="image"||role==="css"?ref.fragment:null;
  const resource=manifest.get(ref.id);
  if(!resource||!isMobiResourceRoleAllowed(resource.mediaType,role))throw new Error("MOBI原版资源缺失或角色不符");
  if(!supported.has(resource.mediaType)){dropped.add(resource.mediaType);return null;}
  return ref.id+ref.fragment;
 };
 const resolve=(value:string,role:MobiResourceRole):string|null=>{
  if(role==="navigation")return nav.has(value)?value:null;
  const ref=accept(value,role);if(ref&&!ref.startsWith("#"))roots.push({ref,role});return ref;
 };
 const validate=(value:string,role:MobiResourceRole):boolean=>role==="navigation"?nav.has(value):accept(value,role)!==null;
 const chapters:MobiPublication["chapters"]=[],navigation:MobiPublication["navigation"]=[];
 for(const chapter of snapshot.chapters){
  const targets=prepared.navigation.filter(n=>n.target.chapterId===chapter.id);
  const body=await sanitizeMobiDocument(chapter.html,{resolve,validate,points:targets.map(n=>n.target.point),mode:"body"});
  // WHY：仅真实stylesheet节点能表示样式已接入；content等惰性字符串包含同名资源不能冒充link。
  const linked=new Set<string>(),nodes=[...parseMobiSanitizerTree(chapter.head,"head").childNodes];
  while(nodes.length){const node=nodes.pop()!;if("tagName"in node){if(node.tagName==="link"&&node.attrs.find(a=>a.name==="rel")?.value.toLowerCase().split(/\s+/u).includes("stylesheet")){const href=node.attrs.find(a=>a.name==="href")?.value;if(href)linked.add(href);}nodes.push(...node.childNodes);}}
  const extra=chapter.css.filter(id=>!linked.has(id)).map(id=>`<link rel="stylesheet" href="${id}">`).join("");
  const head=await sanitizeMobiDocument(chapter.head+extra,{resolve,validate,mode:"head"});
  const id=mobiSourceHref(snapshot.kind,chapter.id);
  chapters.push({id,title:chapter.title,html:body.html,head:head.html,htmlHash:digest(body.html)});
  for(const [index,item]of targets.entries()){const point=body.points[index];if(!point)throw new Error("MOBI导航目标在发布净化中丢失");navigation.push({href:item.href,chapterId:id,point});}
 }
 const graph=await createMobiResourceGraph(snapshot.resources).process(roots,async(resource,graphResolve)=>{
  const resolve=async(value:string,role:Exclude<MobiResourceRole,"navigation">)=>{const ref=accept(value,role,resource.id);return ref?graphResolve(ref,role):null;};
  if(resource.mediaType==="text/css")return new TextEncoder().encode(await sanitizeMobiCss(text(resource.bytes),resolve)||"/* empty */");
  if(resource.mediaType==="image/svg+xml"){
   const svg=await sanitizeMobiDocument(text(resource.bytes),{resolve:(value,role)=>role==="navigation"?null:resolve(value,role),validate,mode:"body"});
   return new TextEncoder().encode(svg.html);
  }
  const image=await validateMobiBinaryResource(resource);if(!image)throw new Error("MOBI图片类型暂不支持");return image.bytes;
 });
 const links=new Set(navigation.map(n=>n.href));
 const toc=snapshot.toc.flatMap(item=>{const target=prepared.navigation.find(n=>n.locator===item.href);return target&&links.has(target.href)?[{label:item.label,href:target.href,depth:item.depth}]:[];});
 const warnings:string[]=[];
 if(dropped.size)warnings.push("本书含暂未支持的内嵌字体、BMP图片或音视频，相关资源已省略，文字使用系统字体；原文件完整保留。");
 if(prepared.diagnostics.length||prepared.resourceDiagnostics.length)warnings.push("已隔离书内脚本、外部资源或不安全样式；原文件完整保留。");
 const content={schema:"mobi-publication-v1" as const,sourceHash:snapshot.sourceHash,title:snapshot.title,authors:snapshot.authors,chapters,navigation,
  resources:graph.resources.map(r=>({id:r.id,mediaType:r.mediaType,base64:Buffer.from(r.bytes).toString("base64"),hash:r.outputHash})),
  toc:toc.length?toc:chapters.map(c=>({label:c.title,href:c.id,depth:0})),warnings};
 const result={...content,layoutHash:digest(JSON.stringify(content))};
 return readMobiPublication(result,snapshot.sourceHash);
}
