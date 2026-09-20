import {parseFb2Xml,fb2Elements,fb2NormalizedText,fb2Text,FB2_NAMESPACE,type Fb2XmlNode,type Fb2XmlElement} from './fb2-xml';
export type Fb2Node=string|{tag:string;attributes:Record<string,string>;children:Fb2Node[]};
export type Fb2Image={id:string;type:string;bytes:Uint8Array};
export type Fb2Section={href:string;title:string;linear?:'no';nodes:Fb2Node[];paragraphs:string[]};
export type Fb2Book={title:string;author:string;language:string;sections:Fb2Section[];images:Fb2Image[]};
const XLINK='http://www.w3.org/1999/xlink';
const tags:Record<string,string>={section:'section',body:'section',title:'header',p:'p',subtitle:'h2',epigraph:'blockquote',annotation:'aside',cite:'blockquote',poem:'blockquote',stanza:'div',v:'p','text-author':'p',date:'p','empty-line':'br',table:'table',tr:'tr',td:'td',th:'th',strong:'strong',emphasis:'em',style:'span',strikethrough:'s',sub:'sub',sup:'sup',code:'code',a:'a'};
function href(node:Fb2XmlElement):string|undefined{return Object.keys(node.attributes).filter(key=>key.split(':').at(-1)==='href'&&node.attributeNamespaces[key]===XLINK).map(key=>node.attributes[key])[0];}
function images(root:Fb2XmlElement):Fb2Image[]{let total=0;const ids=new Set<string>();return fb2Elements(root,'binary').map(node=>{
 const id=node.attributes.id,type=node.attributes['content-type']?.toLowerCase(),base64=fb2Text(node).replace(/[\t\n\r ]/gu,'');
 if(!id||ids.has(id)||id.length>1024)throw new Error('FB2图片ID缺失、重复或过长');ids.add(id);
 if(!type||!['image/png','image/jpeg','image/gif','image/webp'].includes(type))throw new Error('FB2图片格式暂不支持：'+(type??'未知'));
 if(!base64||base64.length>12*1024*1024||base64.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64))throw new Error('FB2图片base64内容无效或超限');
 const raw=atob(base64),bytes=Uint8Array.from(raw,char=>char.charCodeAt(0));total+=bytes.length;
 if(bytes.length>8*1024*1024||total>16*1024*1024)throw new Error('FB2图片总量超限');
 const prefix=(values:number[])=>values.every((value,index)=>bytes[index]===value),ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
 if(!(type==='image/png'&&prefix([137,80,78,71,13,10,26,10])||type==='image/jpeg'&&prefix([255,216,255])||type==='image/gif'&&['GIF87a','GIF89a'].includes(ascii(0,6))||type==='image/webp'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'))throw new Error('FB2图片内容与声明类型不一致');
 return {id,type,bytes};
 });}
export function parseFb2Book(bytes:Uint8Array):Fb2Book{
 const root=parseFb2Xml(bytes),description=fb2Elements(root,'description')[0],info=description&&fb2Elements(description,'title-info')[0];
 const title=info&&fb2Elements(info,'book-title')[0],language=info&&fb2Elements(info,'lang')[0];
 const author=info?fb2Elements(info,'author').map(person=>{const nickname=fb2Elements(person,'nickname')[0];return nickname?fb2NormalizedText(nickname):['first-name','middle-name','last-name'].map(name=>{const value=fb2Elements(person,name)[0];return value?fb2NormalizedText(value):'';}).filter(Boolean).join(' ');}).filter(Boolean).join('、'):'';
 const imageData=images(root),imageIds=new Set(imageData.map(image=>image.id)),bodies=fb2Elements(root,'body');
 if(!bodies.length||bodies.length>256)throw new Error('FB2正文body缺失或数量超限');
 const groups:{elements:Fb2XmlElement[];notes:boolean;label?:string}[]=[];
 const cover=info&&fb2Elements(info,"coverpage")[0];if(cover){const artwork=fb2Elements(cover,"image");if(artwork.length)groups.push({elements:artwork,notes:false,label:"封面"});}
 for(const [index,body]of bodies.entries()){
  if(body.children.some(child=>typeof child==='string'&&child.trim()))throw new Error('FB2 body中存在未归属段落的文字');
  const children=fb2Elements(body);if(index>0||body.attributes.name==='notes'){groups.push({elements:[body],notes:body.attributes.name==='notes'});continue;}
  let leading:Fb2XmlElement[]=[];for(const child of children){if(child.name==='section'){if(leading.length){groups.push({elements:leading,notes:false});leading=[];}groups.push({elements:[child],notes:false});}else leading.push(child);}if(leading.length)groups.push({elements:leading,notes:false});
 }
 if(!groups.length||groups.length>4096)throw new Error('FB2章节缺失或数量超限');
 const locations=new Map<string,string>();
 const visit=(node:Fb2XmlElement,location:string)=>{if(![FB2_NAMESPACE,''].includes(node.namespace))throw new Error('FB2正文包含不支持的命名空间');const id=node.attributes.id;if(id){if(id.length>1024||locations.has(id))throw new Error('FB2正文ID重复或过长');locations.set(id,location);}for(const child of fb2Elements(node))visit(child,location);};
 groups.forEach((group,index)=>group.elements.forEach(node=>visit(node,'fb2-v1/section-'+index+'.xhtml')));
 const navigationIds=new Set(locations.keys());let characters=0,automaticId=0;
 const sections=groups.map((group,index):Fb2Section=>{
  const paragraphs:string[]=[],location='fb2-v1/section-'+index+'.xhtml';
  const convert=(node:Fb2XmlNode,parent=''):Fb2Node=>{
   if(typeof node==='string'){if(node.trim()&&!['p','v','subtitle','text-author','date','td','th','strong','emphasis','style','strikethrough','sub','sup','code','a'].includes(parent))throw new Error('FB2文字未归属可定位段落');return node;}
   const attributes:Record<string,string>={class:'fb2-'+node.name};if(node.attributes.id)attributes.id=node.attributes.id;
   if(node.name==='section'&&!attributes.id){let id:string;do{id='judu-fb2-section-'+automaticId++;}while(navigationIds.has(id));navigationIds.add(id);attributes.id=id;}
   if(node.name==='image'){if(node.children.some(child=>typeof child!=='string'||child.trim()))throw new Error('FB2图片节点不能包含正文');const link=href(node);if(!link?.startsWith('#')||!imageIds.has(link.slice(1)))throw new Error('FB2图片必须引用本文件中存在的binary');return {tag:'img',attributes:{...attributes,'data-fb2-image':link.slice(1),alt:node.attributes.alt??'',title:node.attributes.title??''},children:[]};}
   const inline=new Set(['strong','emphasis','style','strikethrough','sub','sup','code','a']);
   if((['p','v','subtitle','text-author','date','td','th'].includes(parent)||inline.has(parent))&&!inline.has(node.name))throw new Error('FB2行内内容不能嵌套块级元素');
   let tag=Object.hasOwn(tags,node.name)?tags[node.name]:undefined;if(!tag)throw new Error('FB2正文元素暂不支持：'+node.name);if(node.name==='p'&&parent==='title')tag='h1';
   if(node.name==='a'){const link=href(node);if(!link)throw new Error('FB2链接缺少XLink目标');if(link.startsWith('#')){const destination=locations.get(link.slice(1));if(!destination)throw new Error('FB2内部引用目标不存在');attributes.href='/'+destination+'#'+encodeURIComponent(link.slice(1));if(node.attributes.type==='note')attributes['epub:type']='noteref';}
    else{let parsed:URL;try{parsed=new URL(link);}catch{throw new Error('FB2外部链接无效');}if(!['http:','https:','mailto:'].includes(parsed.protocol))throw new Error('FB2链接协议不允许');attributes.href=parsed.href;}}
   for(const name of ['colspan','rowspan'])if(node.attributes[name]!==undefined){const value=Number(node.attributes[name]);if(!Number.isSafeInteger(value)||value<1||value>256)throw new Error('FB2表格跨度无效');attributes[name]=String(value);}
   if(node.attributes.align&&['left','center','right','justify'].includes(node.attributes.align))attributes.class+=' fb2-align-'+node.attributes.align;
   const children=node.children.map(child=>convert(child,node.name)),result={tag,attributes,children};
   if(['p','h1','h2','td','th'].includes(tag)){
    const nested=children.some(child=>typeof child!=='string'&&['p','h1','h2','td','th','table'].includes(child.tag));if(nested)throw new Error('FB2段落或表格单元嵌套结构无效');
    const text=visibleText(result).replace(/\s+/gu,' ').trim();if(text){characters+=text.length;if(characters>8_000_000)throw new Error('FB2正文超过800万UTF16单位上限');attributes['data-fb2-paragraph']=String(paragraphs.length);paragraphs.push(text);}
   }
   return result;
  };
  const nodes=group.elements.map(node=>convert(node));const first=group.elements[0],heading=first.name==='title'?first:fb2Elements(first,'title')[0];
  return {href:location,title:group.label??(heading?fb2NormalizedText(heading):group.notes?'注释':'第 '+(index+1)+' 章'),...(group.notes?{linear:'no' as const}:{}),nodes,paragraphs};
 });
 const hasImage=(node:Fb2Node):boolean=>typeof node!=='string'&&(node.tag==='img'||node.children.some(hasImage));
 if(!sections.some(section=>section.paragraphs.length||section.nodes.some(hasImage)))throw new Error('FB2没有可阅读正文或图片');
 return {title:title?fb2NormalizedText(title):'',author:author||'未知作者',language:language?fb2NormalizedText(language):'',sections,images:imageData};
}
export function visibleText(node:Fb2Node):string{return typeof node==='string'?node:node.tag==='img'?'':node.children.map(visibleText).join('');}
