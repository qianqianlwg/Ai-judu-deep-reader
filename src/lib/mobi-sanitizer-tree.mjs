// @ts-check
import {createHash} from 'node:crypto';
import {parse, parseFragment, defaultTreeAdapter as adapter, html} from 'parse5';
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} Node */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.ParentNode} Parent */
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutPoint} Point */
/** @typedef {'body'|'head'|'document'} Mode */
export const MOBI_TREE_LIMITS = Object.freeze({nodes:100_000, depth:128, input:4*1024*1024, characters:8*1024*1024});
const digest = (/** @type {string} */ value) => createHash('sha256').update(value).digest('hex');
/** @param {string} text @param {number} offset */
function boundary(text, offset) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
    && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset-1]) && /[\uDC00-\uDFFF]/u.test(text[offset]));
}
/** 全树检查必须先于删除和异步resolver；包含template内容，不能靠删根节点逃过预算。
 * @param {Parent} root
 */
export function checkMobiTree(root) {
  const stack = [{node:/** @type {Node} */(root), depth:0}];
  let nodes=0, characters=0;
  while(stack.length) {
    const item=stack.pop(); if(!item)break;
    const {node,depth}=item;
    if(++nodes>MOBI_TREE_LIMITS.nodes || depth>MOBI_TREE_LIMITS.depth)throw new Error('MOBI章节节点预算超限或嵌套过深');
    if(adapter.isTextNode(node))characters+=node.value.length;
    if(adapter.isCommentNode(node))characters+=node.data.length;
    if(adapter.isElementNode(node)) {
      characters+=node.tagName.length;
      for(const attr of node.attrs)characters+=attr.name.length+attr.value.length;
      if(node.tagName === 'template' && 'content' in node)stack.push({node:node.content,depth:depth+1});
    }
    if(characters>MOBI_TREE_LIMITS.characters)throw new Error('MOBI章节字符预算超限');
    if('childNodes' in node)for(const child of node.childNodes)stack.push({node:child,depth:depth+1});
  }
}
/** @param {string} source @param {Mode} mode @param {boolean} [output] @returns {Parent} */
export function parseMobiSanitizerTree(source, mode, output=false) {
  if(typeof source!=='string'||source.length>(output?MOBI_TREE_LIMITS.characters:MOBI_TREE_LIMITS.input))throw new Error('MOBI章节输入字符超限');
  if(!['body','head','document'].includes(mode))throw new Error('MOBI章节解析上下文无效');
  // WHY：解析过程中即限制创建节点；即使后来整棵form/template被丢弃也不能先无界分配。
  let created=0; const located=new WeakSet();
  /** @type {import('parse5').ParserOptions<import('parse5').DefaultTreeAdapterMap>} */
  const options={scriptingEnabled:true,sourceCodeLocationInfo:true,treeAdapter:{...adapter,
    setNodeSourceCodeLocation(node, location) {
      if(!located.has(node)){located.add(node);if(++created>MOBI_TREE_LIMITS.nodes)throw new Error('MOBI章节节点预算超限');}
      adapter.setNodeSourceCodeLocation(node,location);
    },
  }};
  // WHY：由组合根明确声明上下文，不用HTML内的字符串/注释猜document，否则首部空白和表格路径会变。
  const root=mode==='document'?parse(source,options):parseFragment(adapter.createElement(mode,html.NS.HTML,[]),source,options);
  checkMobiTree(root);return root;
}
/** 原目标先绑定具体对象和文本hash；净化后不按重复文本查找替代位置。
 * @param {Parent} root @param {readonly Point[]} points
 */
export function captureMobiPoints(root, points) {
  if(!Array.isArray(points)||points.length>20000)throw new Error('MOBI章节目标数超限');
  return points.map(point=>{
    if(!point||!Array.isArray(point.path)||!point.path.length||point.path.length>MOBI_TREE_LIMITS.depth)throw new Error('MOBI净化来源路径无效');
    /** @type {Node|undefined} */let node=root;
    for(const index of point.path){if(!Number.isSafeInteger(index)||index<0||!node||!('childNodes' in node))throw new Error('MOBI净化来源路径无效');node=node.childNodes[index];}
    if(!node)throw new Error('MOBI净化来源节点不存在');
    if(point.kind==='element'){
      if(!adapter.isElementNode(node)||node.tagName!==point.tag||point.offset!==0)throw new Error('MOBI净化来源元素不匹配');
    }else if(point.kind!=='text'||!adapter.isTextNode(node)||node.value.length!==point.textLength||digest(node.value)!==point.textHash||!boundary(node.value,point.offset))throw new Error('MOBI净化来源文本不匹配');
    return {node,point};
  });
}
/** 将序列化前后的相邻文本归并后逐节点比较，再输出真实重解析路径。
 * @param {Parent} before @param {Parent} after @param {ReturnType<typeof captureMobiPoints>} captured
 * @returns {(Point|null)[]}
 */
export function rebaseMobiPoints(before,after,captured){
  /** @type {WeakMap<Node,{path:number[],offset:number,node:Node}>} */const positions=new WeakMap();
  const pending=[{before,after,path:/** @type {number[]} */([])}];
  while(pending.length){
    const pair=pending.pop();if(!pair)break;
    let sourceIndex=0;
    for(const [index,target] of pair.after.childNodes.entries()){
      const source=pair.before.childNodes[sourceIndex],path=[...pair.path,index];
      if(!source)throw new Error('MOBI净化序列化结构发生变化');
      if(adapter.isTextNode(target)){
        let value='';
        while(sourceIndex<pair.before.childNodes.length){
          const next=pair.before.childNodes[sourceIndex];if(!adapter.isTextNode(next))break;
          positions.set(next,{path,offset:value.length,node:target});value+=next.value;sourceIndex++;
        }
        if(value!==target.value)throw new Error('MOBI净化序列化文本发生变化');
      }else{
        if(!adapter.isElementNode(source)||!adapter.isElementNode(target)||source.namespaceURI!==target.namespaceURI||source.tagName!==target.tagName
          ||JSON.stringify(source.attrs)!==JSON.stringify(target.attrs))throw new Error('MOBI净化序列化结构发生变化');
        positions.set(source,{path,offset:0,node:target});sourceIndex++;
        pending.push({before:source,after:target,path});
      }
    }
    if(sourceIndex!==pair.before.childNodes.length)throw new Error('MOBI净化序列化节点丢失');
  }
  return captured.map(({node,point})=>{
    const current=positions.get(node);if(!current)return null;
    if(point.kind==='element')return {kind:'element',path:current.path,tag:point.tag,offset:0};
    if(!adapter.isTextNode(current.node))throw new Error('MOBI净化目标类型变化');
    const text=current.node.value,offset=current.offset+point.offset;
    if(!boundary(text,offset))throw new Error('MOBI净化目标字符边界无效');
    return {kind:'text',path:current.path,offset,textLength:text.length,textHash:digest(text)};
  });
}
