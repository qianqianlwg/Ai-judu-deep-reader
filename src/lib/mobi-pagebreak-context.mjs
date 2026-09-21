// @ts-check
import { parse, html as parse5Html } from "parse5";
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} Node */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Element} Element */
/** @typedef {{start:number,end:number}} Break */
const MAX_HTML=20_000_000,MAX_BREAKS=10_000,MAX_DEPTH=128,HTML=parse5Html.NS.HTML;
const PAGEBREAK=new Set(["mbp:pagebreak","pagebreak"]);
/** @param {string} value */
const escape=value=>value.replaceAll("&","&amp;").replaceAll('"',"&quot;");
/** @param {string} value */
const integer=value=>/^[+-]?\d+$/u.test(value.trim())?Number(value):null;
/** @param {Node|null} node */
function logicalParent(node){let current=node;while(current&&"tagName"in current&&PAGEBREAK.has(current.tagName))current=current.parentNode;return current;}
/** @param {Element} list @param {number} at */
function nextListOrdinal(list,at){
 const reversed=list.attrs.some(a=>a.name==="reversed"),step=reversed?-1:1;
 const items=[];/** @type {Node[]} */const stack=[...list.childNodes];
 while(stack.length){const node=stack.pop();if(!node)break;if("tagName"in node&&node.tagName==="li"&&logicalParent(node.parentNode)===list)items.push(node);if("childNodes"in node)for(const child of node.childNodes)stack.push(child);}
 items.sort((a,b)=>(a.sourceCodeLocation?.startOffset??Infinity)-(b.sourceCodeLocation?.startOffset??Infinity));
 const declared=integer(list.attrs.find(a=>a.name==="start")?.value??"");let ordinal=declared??(reversed?items.length:1);
 for(const item of items){const start=item.sourceCodeLocation?.startOffset;if(start===undefined||start>=at)continue;const value=integer(item.attrs.find(a=>a.name==="value")?.value??"");if(value!==null)ordinal=value;ordinal+=step;}
 return Number.isSafeInteger(ordinal)?ordinal:null;
}
/** @param {Element} element @param {number} at */
function openTag(element,at){
 if(element.namespaceURI!==HTML||PAGEBREAK.has(element.tagName)||element.tagName==="html"||element.tagName==="body")throw new Error("MOBI分页祖先无效");
 const attrs=element.attrs.map(attr=>({name:attr.name,value:attr.value}));
 if(element.tagName==="ol"){
  const start=nextListOrdinal(element,at);if(start===null)throw new Error("MOBI有序列表分页序号无效");
  const existing=attrs.find(attr=>attr.name==="start");if(existing)existing.value=String(start);else attrs.push({name:"start",value:String(start)});
 }
 return `<${element.tagName}${attrs.map(attr=>` ${attr.name}="${escape(attr.value)}"`).join("")}>`;
}
/**
 * 根据完整解码文档恢复每个pagebreak后的开放祖先。输入位置是解码文本UTF-16偏移，不是原文件字节。
 * @param {string} source @param {readonly {start:number,end:number}[]} breaks
 * @returns {{prefix:string,suffix:string,depth:number}[]}
 */
export function mobiPagebreakContexts(source,breaks){
 if(typeof source!=="string"||source.length>MAX_HTML||!Array.isArray(breaks)||breaks.length>MAX_BREAKS)throw new Error("MOBI分页上下文输入无效");
 const wanted=new Map();for(const item of breaks){if(!item||!Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.end)||item.start<0||item.end<=item.start||item.end>source.length||wanted.has(item.start))throw new Error("MOBI分页上下文位置无效");wanted.set(item.start,item);}
 const tree=parse(source,{sourceCodeLocationInfo:true,scriptingEnabled:false});/** @type {Map<number,Element>} */const nodes=new Map();/** @type {{node:Node,depth:number}[]} */const stack=[{node:/** @type {Node} */(/** @type {unknown} */(tree)),depth:0}];let visited=0;
 while(stack.length){const entry=stack.pop();if(!entry)break;if(++visited>400_000||entry.depth>MAX_DEPTH)throw new Error("MOBI分页上下文节点超限");const {node}=entry;
  if("tagName"in node&&PAGEBREAK.has(node.tagName)){const sourceLocation=node.sourceCodeLocation;const rawLocation=sourceLocation&&"startTag"in sourceLocation?sourceLocation.startTag:undefined;const location=/** @type {{startOffset:number,endOffset:number}|undefined} */(/** @type {unknown} */(rawLocation));if(location&&wanted.has(location.startOffset)&&location.endOffset===wanted.get(location.startOffset)?.end)nodes.set(location.startOffset,/** @type {Element} */(node));}
  if("childNodes"in node){const children=/** @type {Node[]} */(node.childNodes);for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],depth:entry.depth+1});}
 }
 return breaks.map(item=>{
  const marker=nodes.get(item.start);if(!marker)throw new Error("MOBI分页标记与解析树不一致");/** @type {Element[]} */const ancestors=[];let parent=marker.parentNode;
  while(parent&&"tagName"in parent){if(!PAGEBREAK.has(parent.tagName)&&parent.tagName!=="body"&&parent.tagName!=="html")ancestors.push(parent);parent=parent.parentNode;}
  ancestors.reverse();if(ancestors.length>MAX_DEPTH)throw new Error("MOBI分页祖先过深");
  return {prefix:ancestors.map(node=>openTag(node,item.start)).join(""),suffix:[...ancestors].reverse().map(node=>`</${node.tagName}>`).join(""),depth:ancestors.length};
 });
}
