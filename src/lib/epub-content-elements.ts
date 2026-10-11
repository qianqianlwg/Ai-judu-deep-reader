const canonicalTags = new Set(['h1','h2','h3','h4','h5','h6','p','blockquote','li']);
const textContainerTags = new Set(['div','section','article','header','footer','main','aside','figure','figcaption','pre','dt','dd','td','th','caption']);
const ignoredTags = new Set(['head','script','style','svg','noscript']);
export type EpubElementAdapter<T extends object> = {name(node:T):string|null;children(node:T):readonly T[];decoration?(node:T):boolean};
/** 只按原书结构选内容容器，不根据文字、类名或字号推断标题/生成任何语义。 */
export function epubContentElements<T extends object>(roots:readonly T[], adapter:EpubElementAdapter<T>, includeTextContainers=true):T[] {
  const result:T[]=[];
  const descendantCache=new WeakMap<T,boolean>();
  const ignored=(node:T)=>ignoredTags.has(adapter.name(node)??'')||Boolean(adapter.decoration?.(node));
  const isBlock=(node:T)=>canonicalTags.has(adapter.name(node)??'')||(includeTextContainers&&textContainerTags.has(adapter.name(node)??''));
  const hasBlockDescendant=(node:T):boolean=>{
    const cached=descendantCache.get(node);if(cached!==undefined)return cached;
    const value=adapter.children(node).some(child=>!ignored(child)&&(isBlock(child)||hasBlockDescendant(child)));
    descendantCache.set(node,value);return value;
  };
  const visit=(node:T)=>{
    if(ignored(node))return;
    const name=adapter.name(node)??'';
    // WHY：既有 p/blockquote/li 是不可拆分的逐字来源；非标准样式标题仅收录独立文本容器，不能重复收录其外层包装。
    if(canonicalTags.has(name)||(includeTextContainers&&textContainerTags.has(name)&&!hasBlockDescendant(node))){result.push(node);return;}
    for(const child of adapter.children(node))visit(child);
  };
  for(const root of roots)visit(root);
  return result;
}
export function epubDocumentContentElements(doc:Document):Element[]{
  return doc.body?epubContentElements<Element>([doc.body],{name:node=>node.localName.toLowerCase(),children:node=>Array.from(node.children),decoration:node=>node.hasAttribute('data-judu-decoration')}):[];
}
