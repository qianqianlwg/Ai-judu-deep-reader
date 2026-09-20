// @ts-check
import {createHash} from 'node:crypto';
import {mobiNavigationToken} from './mobi-prepared-layout';
import {readMobiLayoutSnapshot} from './mobi-layout-snapshot';
import {verifyMobiLayoutTargets} from './mobi-layout-targets.mjs';
import {sanitizeMobiDocument} from './mobi-document-sanitizer.mjs';
import {sanitizeMobiCss} from './mobi-css-sanitizer.mjs';
import {createMobiResourceGraph, resolveMobiResourceReference, isMobiResourceRoleAllowed} from './mobi-resource-graph.mjs';
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutSnapshot} Snapshot */
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutTarget} Target */
/** @typedef {import('./mobi-document-sanitizer.mjs').MobiDiagnostic} Diagnostic */
/** @typedef {'image'|'style'|'media'|'css'} Role */
const hash=(/** @type {string} */ text)=>createHash('sha256').update(text).digest('hex');
/**
 * worker内组合根：净化章节和CSS/SVG、重投影已核验来源、校验包内资源图。
 * WHY：结果仍使用untrusted协议。图片/字体/媒体字节尚未解码；不可凭本函数直接公开原版。
 * @param {Snapshot} input
 */
export async function prepareMobiLayoutMarkup(input) {
  const snapshot=readMobiLayoutSnapshot(input);
  verifyMobiLayoutTargets(snapshot);
  const manifest=new Map(snapshot.resources.map(r=>[r.id,r]));
  /** @type {{ref:string,role:Role}[]} */const roots=[];
  /** @type {{chapterId:string,entry:Diagnostic}[]} */const diagnostics=[];
  const refs=[...snapshot.toc,...snapshot.links];
  /** @type {Map<string,Target>} */const originals=new Map();
  /** @type {Map<string,string>} */const navigation=new Map();
  for(const ref of refs)if(ref.target){
    const old=originals.get(ref.href);
    if(old && JSON.stringify(old)!==JSON.stringify(ref.target))throw new Error('MOBI相同locator目标不一致');
    originals.set(ref.href,ref.target);
    if(!navigation.has(ref.href))navigation.set(ref.href,mobiNavigationToken(ref.href));
  }
  /** @type {Map<string,Target|null>} */const projected=new Map();
  /** @param {string} value @param {Role} role */
  function resource(value,role){
    const ref=resolveMobiResourceReference(value,'mobi-resource-v1/document.html');
    if('blocked' in ref)return null;
    if(!ref.id)return role==='style'||role==='media'?null:ref.fragment;
    const found=manifest.get(ref.id);
    if(!found)throw new Error('MOBI章节引用缺少本地资源');
    if(!isMobiResourceRoleAllowed(found.mediaType,role))throw new Error('MOBI章节资源角色不符');
    if(roots.length>=20000)throw new Error('MOBI章节资源引用超限');
    roots.push({ref:ref.id+ref.fragment,role});return ref.id+ref.fragment;
  }
  /** @param {string} token @param {import('./mobi-document-sanitizer.mjs').MobiResourceRole} role */
  function validate(token,role){
    if(role==='navigation')return [...navigation.values()].includes(token);
    const found=manifest.get(token.split('#',1)[0]);
    return Boolean(found&&isMobiResourceRoleAllowed(found.mediaType,role));
  }
  /** @param {string} value @param {import('./mobi-document-sanitizer.mjs').MobiResourceRole} role */
  const resolve=(value,role)=>role==='navigation'?navigation.get(value)??null:resource(value,role);
  /** @type {Snapshot['chapters']} */const chapters=[];
  for(const chapter of snapshot.chapters){
    const targets=[...originals].filter(([,target])=>target.chapterId===chapter.id);
    const body=await sanitizeMobiDocument(chapter.html,{resolve,validate,mode:'body',points:targets.map(([,target])=>target.point)});
    const head=await sanitizeMobiDocument(chapter.head,{resolve,validate,mode:'head'});
    for(const [i,[href,target]] of targets.entries()){
      const point=body.points[i];projected.set(href,point?{...target,htmlHash:hash(body.html),point}:null);
    }
    for(const entry of [...body.diagnostics,...head.diagnostics]){
      if(diagnostics.length>=50000)throw new Error('MOBI全书净化诊断超限');diagnostics.push({chapterId:chapter.id,entry});
    }
    for(const css of chapter.css)resource(css,'style');
    chapters.push({...chapter,html:body.html,head:head.html});
  }
  if(snapshot.cover)resource(snapshot.cover,'image');
  // WHY：保留原捕获资源（含未引用封面/字体），只替换CSS/SVG文本，不以丢弃资源冒充原版保真。
  const graph=await createMobiResourceGraph(snapshot.resources).process(roots,async (entry,resolve)=>{
    if(entry.mediaType!=='text/css'&&entry.mediaType!=='image/svg+xml')return entry.bytes;
    const source=new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes);
    if(entry.mediaType==='text/css')return new TextEncoder().encode(await sanitizeMobiCss(source,resolve)||'/* empty safe stylesheet */');
    const svg=await sanitizeMobiDocument(source,{mode:'body',resolve:(value,role)=>role==='navigation'?null:resolve(value,role),validate});
    return new TextEncoder().encode(svg.html);
  });
  const replacements=new Map(graph.resources.map(r=>[r.id,r]));
  /** @type {Snapshot} */const output={...snapshot,chapters,
    resources:snapshot.resources.map(r=>{const transformed=replacements.get(r.id);return transformed?{id:r.id,mediaType:r.mediaType,bytes:transformed.bytes}:r;}),
    toc:snapshot.toc.map(r=>({...r,target:projected.get(r.href)??null})),
    links:snapshot.links.map(r=>{const target=projected.get(r.href)??null;return {...r,target,reason:target?'exact-source':r.reason==='external'?'external':'unresolved'};}),
  };
  verifyMobiLayoutTargets(output);
  return {snapshot:readMobiLayoutSnapshot(output),diagnostics,resourceDiagnostics:graph.diagnostics,
    navigation:[...navigation].flatMap(([locator,href])=>{const target=projected.get(locator);return target?[{locator,href,target}]:[];})};
}
