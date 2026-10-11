import { pathToFileURL } from 'node:url';
const { JSDOM } = await import(pathToFileURL(process.argv[2]).href);
import JSZip from 'jszip';
import path from 'node:path';
import { EPUB } from '../../public/vendor/foliate/epub.js';

// WHY：上游DOM解析只在独立Node进程安装全局对象，不污染Next请求，也不运行书内脚本、布局或网络资源。
const window = new JSDOM('').window;
globalThis.DOMParser = window.DOMParser;
console.warn = (...args) => console.error(...args);
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 64 * 1024 * 1024) throw new Error('EPUB worker输入超过64 MiB');
  chunks.push(chunk);
}
const zip = await JSZip.loadAsync(Buffer.concat(chunks));
const canonical = new Map();
for (const [name, file] of Object.entries(zip.files)) {
  if (file.dir) continue;
  let key;
  try { key = decodeURI(name); } catch { key = name;console.warn('归档采用字面百分号文件名',name); }
  // WHY：合法字面百分号与空格文件可共存；优先精确寻址，只有实际请求歧义别名时才拒绝。
  if (canonical.has(key) && canonical.get(key) !== name) canonical.set(key, null);
  else canonical.set(key, name);
}
const get = name => {
  const literal=zip.file(name);if(literal)return literal;
  let key;try{key=decodeURI(name);}catch{return null;}
  if(canonical.has(key)&&canonical.get(key)===null)throw new Error('归档资源URI存在歧义：'+name);
  return zip.file(canonical.get(key)??'');
};
const loadText = async name => {
  const file = get(name);
  return file ? file.async('string') : null;
};
const engine = new EPUB({ loadText, loadBlob: async () => { throw new Error('导入解析不加载布局或二进制资源'); }, getSize: () => 0 });
try {
  await engine.init();
  if(engine.sections.length!==engine.resources.spine.length)throw new Error('EPUB spine引用了缺失章节，未跳过内容');
  if((engine.resources.navPath||engine.resources.ncxPath)&&!Array.isArray(engine.toc))throw new Error('原书目录解析失败，未自动生成目录');
  const opf = engine.resources.opf;
  const container = new window.DOMParser().parseFromString(await loadText('META-INF/container.xml'), 'application/xml');
  const rootPath = [...container.getElementsByTagNameNS('*', 'rootfile')].find(item=>item.getAttribute('media-type')==='application/oebps-package+xml')?.getAttribute('full-path');
  if(!rootPath)throw new Error('EPUB缺少有效包文档路径');
  const rawItems = new Map([...opf.getElementsByTagNameNS('*', 'item')].map(item => [item.getAttribute('id'), item]));
  const sections = [];
  for (const [index, section] of engine.sections.entries()) {
    const spine = engine.resources.spine[index];
    const item = rawItems.get(spine.idref);
    const sourceHref = path.posix.normalize(path.posix.join(path.posix.dirname(rootPath), item.getAttribute('href')));
    const html = await loadText(section.id);
    if (html === null) throw new Error('原书章节资源不存在：' + sourceHref);
    const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1]?.trim() ?? html;
    sections.push({ id: spine.idref, sourceHref, html: body });
  }
  const languageText = value => typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).find(v => typeof v === 'string') ?? '' : '';
  let tocCount=0;
  const toc = (items,depth=0) => {if(depth>32)throw new Error('原书目录超过32层');return (items ?? []).map(item => {if(++tocCount>5000)throw new Error('原书目录超过5000项');return { label: typeof item.label === 'string' ? item.label : '', href: typeof item.href === 'string' ? item.href : null, children: toc(item.subitems,depth+1) };});};
  process.stdout.write(JSON.stringify({ title: languageText(engine.metadata.title), author: (Array.isArray(engine.metadata.author) ? engine.metadata.author : engine.metadata.author ? [engine.metadata.author] : []).map(item => typeof item === 'string' ? item : languageText(item.name)).filter(Boolean).join('、'), sections, navigation: toc(engine.toc) }));
} finally {
  engine.destroy(); window.close();
}
