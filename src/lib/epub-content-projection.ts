import {parseFragment,type DefaultTreeAdapterTypes} from 'parse5';
import {epubContentElements} from './epub-content-elements';
import type {HeadingLevel,ParsedSourceBlock} from './source-block';
type HtmlNode=DefaultTreeAdapterTypes.ChildNode;
export type EpubContentProjection={blocks:ParsedSourceBlock[];legacyBlocks:ParsedSourceBlock[];legacySourceOrdinals:(number|null)[]};
export function projectEpubContent(html:string,cleanText:(html:string)=>string):EpubContentProjection{
  const content=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const legacyBlocks:ParsedSourceBlock[]=[];
  const legacyAt=new Map<number,number>();
  let legacyOrdinal=0;
  for(const match of content.matchAll(/<(h[1-6]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
    const text=cleanText(match[2]),heading=/^h[1-6]$/iu.test(match[1]);
    legacyAt.set(match.index,legacyOrdinal);
    if(text)legacyBlocks.push({kind:heading?'heading':'paragraph',text,...(heading?{headingLevel:Number(match[1][1]) as HeadingLevel}:{}),sourceOrdinal:legacyOrdinal});
    legacyOrdinal++;
  }
  const document=parseFragment(content,{sourceCodeLocationInfo:true});
  const candidates=epubContentElements<HtmlNode>(document.childNodes,{name:node=>'tagName' in node?node.tagName.toLowerCase():null,children:node=>'childNodes' in node?node.childNodes:[]});
  const blocks:ParsedSourceBlock[]=[],legacySourceOrdinals:(number|null)[]=[];
  candidates.forEach((node,sourceOrdinal)=>{
    if(!('tagName' in node))return;
    const location=node.sourceCodeLocation;
    if(!location?.startTag)throw new Error('原书内容块缺少真实元素边界，不能猜测来源');
    const inner=content.slice(location.startTag.endOffset,location.endTag?.startOffset??location.endOffset);
    const text=cleanText(inner);if(!text)return;
    const heading=/^h[1-6]$/iu.test(node.tagName);
    blocks.push({kind:heading?'heading':'paragraph',text,...(heading?{headingLevel:Number(node.tagName[1]) as HeadingLevel}:{}),sourceOrdinal});
    legacySourceOrdinals.push(legacyAt.get(location.startOffset)??null);
  });
  if(!legacyBlocks.length){
    const text=cleanText(content);
    if(text){legacyBlocks.push({kind:'paragraph',text,sourceOrdinal:0});if(blocks.length===1&&blocks[0].text===text)legacySourceOrdinals[0]=0;}
  }
  if(!blocks.length&&legacyBlocks.length){blocks.push({...legacyBlocks[0]});legacySourceOrdinals.push(0);}
  // WHY：旧投影单独保留用于逐字迁移；新增独立文本块不覆盖旧正文，CSS类名只能保留原貌，不能充当标题层级证据。
  return {blocks,legacyBlocks,legacySourceOrdinals};
}
