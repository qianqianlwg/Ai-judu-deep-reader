// @ts-check
import { createHash } from 'node:crypto';
import { mobiHtmlBlocks } from './mobi-html.mjs';
import { captureMobiResources } from './mobi-layout-resources.mjs';
import { buildMobiSourceIndex } from './mobi-source-map.mjs';
import { indexMobiLayout } from './mobi-layout-html.mjs';
import { verifyMobiLayoutTargets } from './mobi-layout-targets.mjs';
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutSnapshot} Snapshot */
/** @param {import('../../vendor/mobi/index.mjs').MobiCandidate} parser @param {{bytes:Uint8Array,kind:'mobi'|'kf8',resourceDir:string}} input @returns {Promise<Snapshot>} */
export async function buildMobiLayout(parser, input) {
  const metadata = parser.getMetadata();
  const spine = parser.getSpine();
  if (!Array.isArray(spine) || !spine.length || spine.length > 10000) throw new Error('MOBI布局章节数无效');
  const ids = new Set(); let characters = 0;
  /** @type {{id:string;title:string;html:string;head:string;css:string[];paragraphs:string[]}[]} */ const rawChapters = [];
  for (const item of spine) {
    if (typeof item.id !== 'string' || !item.id || item.id.length > 256 || ids.has(item.id)) throw new Error('MOBI布局章节标识无效');
    ids.add(item.id); const loaded = parser.loadChapter(item.id);
    if (!loaded || typeof loaded.html !== 'string' || !Array.isArray(loaded.css)) throw new Error('MOBI布局章节无法读取');
    characters += loaded.html.length + loaded.head.length; if (characters > 20_000_000) throw new Error('MOBI布局HTML总量超限');
    const blocks = mobiHtmlBlocks(loaded.html);
    rawChapters.push({id:item.id,title:blocks.heading,html:loaded.html,head:loaded.head,css:loaded.css.map(item=>item.href),paragraphs:blocks.paragraphs});
  }
  const coverPath = parser.getCoverImage();
  const captured = await captureMobiResources(input.resourceDir);
  // WHY：vendor返回稳定包内ID；旧的绝对路径仅可经已捕获集合精确复核，不能猜路径。
  const resourceId = (/** @type {string} */ value) => captured.resources.some(resource=>resource.id===value) ? value : captured.idFor(value);
  const chapters = rawChapters.map(chapter=>({...chapter,html:captured.rewrite(chapter.html),head:captured.rewrite(chapter.head),css:chapter.css.map(href=>resourceId(href))}));
  const indices = new Map(chapters.map(chapter=>[chapter.id,indexMobiLayout(chapter.html)]));
  const sources=chapters.map(chapter=>{const source=parser.getSourceChapter(chapter.id);if(!source)throw new Error('MOBI原始章节来源缺失');return source;});
  const aliases=parser.getResourceAliases();
  if(!Array.isArray(aliases)||aliases.length>20000)throw new Error('MOBI资源来源映射无效');
  /** @type {Map<string,string>} */ const resourceMap=new Map();
  for(const pair of aliases){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||typeof pair[1]!=='string'||resourceMap.has(pair[0]))throw new Error('MOBI资源来源映射无效');const id=resourceId(pair[1]);if(!captured.resources.some(resource=>resource.id===id))throw new Error('MOBI资源来源未捕获');resourceMap.set(pair[0],id);}
  const sourceIndex=buildMobiSourceIndex(input.kind,sources,chapters,resourceMap);
  const target=sourceIndex.resolve;
  /** @type {Snapshot['toc']} */ const toc = [];
  const stack = parser.getToc().map(item=>({item,depth:0})).reverse();
  while (stack.length) {
    const entry = stack.pop(); if (!entry || toc.length >= 10000 || entry.depth > 128) throw new Error('MOBI布局目录超限');
    const {item,depth} = entry;
    if (typeof item.label !== 'string' || item.label.length > 4096 || typeof item.href !== 'string' || item.href.length > 4096) throw new Error('MOBI布局目录无效');
    const resolved = target(item.href); toc.push({label:item.label,href:item.href,target:resolved,depth});
    if (resolved) { const chapter = chapters.find(chapter=>chapter.id === resolved.chapterId); if (chapter && !chapter.title) chapter.title = item.label; }
    if(item.children){if(!Array.isArray(item.children)||stack.length+item.children.length>10000)throw new Error('MOBI目录子项无效');for(let i=item.children.length-1;i>=0;i--)stack.push({item:item.children[i],depth:depth+1});}
  }
  /** @type {Snapshot['links']} */ const links = [];
  for (const chapter of chapters) for (const href of indices.get(chapter.id)?.hrefs ?? []) {
    if (links.length >= 20000 || href.length > 4096) throw new Error('MOBI布局链接超限');
    const resolved = target(href);
    const external = /^(?!filepos:|kindle:)[a-z][\w+.-]*:/iu.test(href) || href.startsWith('//');
    links.push({chapterId:chapter.id,href,target:resolved,reason:resolved?'exact-source':external?'external':'unresolved'});
  }
  /** @type {Snapshot} */const result={schema:'mobi-layout-untrusted-v3',kind:input.kind,sourceHash:createHash('sha256').update(input.bytes).digest('hex'),title:metadata.title??'',authors:metadata.author,cover:coverPath?resourceId(coverPath):null,chapters,resources:captured.resources,toc,links};
  verifyMobiLayoutTargets(result);return result;
}
