import {XMLParser,XMLValidator} from 'fast-xml-parser';
export const FB2_NAMESPACE='http://www.gribuser.ru/xml/fictionbook/2.0';
export const FB2_XML_LIMIT=24*1024*1024;
export type Fb2XmlNode=string|Fb2XmlElement;
export type Fb2XmlElement={name:string;namespace:string;attributes:Record<string,string>;attributeNamespaces:Record<string,string>;children:Fb2XmlNode[]};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const cleanText=(value:string)=>{if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value))throw new Error('FB2包含无效XML字符');return value;};
export function decodeFb2Xml(bytes:Uint8Array):string{
 if(!bytes.byteLength||bytes.byteLength>FB2_XML_LIMIT)throw new Error('FB2文件应为1字节至24MiB');
 const prefix=new TextDecoder('latin1').decode(bytes.subarray(0,512));
 const bom=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':bytes[0]===239&&bytes[1]===187&&bytes[2]===191?'utf-8':null;
 const guess=bom??(bytes[0]===0&&bytes[1]===60?'utf-16be':bytes[0]===60&&bytes[1]===0?'utf-16le':null);
 const declaration=guess?new TextDecoder(guess).decode(bytes.subarray(0,Math.min(bytes.length,512)-Math.min(bytes.length,512)%2)):prefix;
 const declared=declaration.replace(/^\uFEFF/u,'').match(/^<\?xml\s[^?]*encoding\s*=\s*["']([a-z0-9._-]+)["']/iu)?.[1].toLowerCase();
 const encoding=guess??declared??'utf-8';
 if(declared&&guess&&!(new TextDecoder(declared).encoding===guess||declared==='utf-16'&&guess.startsWith('utf-16')))throw new Error('FB2编码声明与BOM冲突');
 // WHY：明确支持常见FB2编码；不能用替代字符静默修复字节后仍声称精确来源。
 if(!['utf-8','utf8','utf-16','utf-16le','utf-16be','windows-1251','windows-1252','iso-8859-1'].includes(encoding))throw new Error('FB2编码暂不支持：'+encoding);
 return cleanText(new TextDecoder(encoding,{fatal:true}).decode(bytes)).replace(/^\uFEFF/u,'');
}
function xmlEntityDecoder(){
 const forbidden=()=>{throw new Error('FB2不允许DTD或自定义实体');};
 return {setExternalEntities:(entities:Record<string,string>)=>{if(Object.keys(entities).length)forbidden();},addInputEntities:forbidden,reset:()=>{},setXmlVersion:(version:unknown)=>{if(Number(version)!==1)throw new Error('FB2仅支持XML 1.0');},decode:(text:string)=>text.replace(/&([^;]+);/gu,(_match:string,name:string)=>{
  if(name==='amp')return '&';if(name==='lt')return '<';if(name==='gt')return '>';if(name==='quot')return '"';if(name==='apos')return "'";
  if(!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/u.test(name))throw new Error('FB2包含未声明实体');const code=name.startsWith('#x')?Number.parseInt(name.slice(2),16):Number(name.slice(1));
  if(!Number.isSafeInteger(code)||!(code===9||code===10||code===13||code>=32&&code<=0xd7ff||code>=0xe000&&code<=0xfffd||code>=0x10000&&code<=0x10ffff))throw new Error('FB2字符引用不是合法XML字符');return String.fromCodePoint(code);
 })};
}
export function parseFb2Xml(bytes:Uint8Array):Fb2XmlElement{
 const xml=decodeFb2Xml(bytes),markup=xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/gu,'');
 // WHY：禁用DTD/自定义实体，不解析外部实体；XML中的地址不触发任何IO。
 if(/<!DOCTYPE|<!ENTITY/iu.test(markup))throw new Error('FB2不允许DTD或自定义实体');
 if(/&(?!(?:amp|lt|gt|quot|apos);|#(?:[0-9]+|x[0-9a-fA-F]+);)/u.test(markup))throw new Error('FB2包含未声明或损坏实体');
 const valid=XMLValidator.validate(xml);if(valid!==true)throw new Error('FB2 XML结构无效：'+valid.err.msg);
 let raw:unknown,parsedElements=0;
 // WHY：构建XML树时限制元素数，不等数百万空标签全部分配后才拒绝；转换时再核验包含文字的总节点数。
 // WHY：固定库默认不解数字引用；在正规解析上下文只解一次XML五实体/合法数值，CDATA不走此解码，不开启HTML实体容错。
 try{raw=new XMLParser({preserveOrder:true,ignoreAttributes:false,attributeNamePrefix:'',trimValues:false,parseTagValue:false,parseAttributeValue:false,processEntities:true,entityDecoder:xmlEntityDecoder(),maxNestedTags:129,updateTag:tag=>{if(++parsedElements>200000)throw new Error('FB2 XML节点数量超限');return tag;},commentPropName:'#comment'}).parse(xml);}
 catch(cause:unknown){if(cause instanceof Error&&cause.message.includes('Maximum nested tags'))throw new Error('FB2 XML层级超限（最大128层）',{cause});throw cause;}
 let nodes=0;
 const convert=(value:unknown,namespaces:Record<string,string>,depth:number):Fb2XmlNode[]=>{
  if(!Array.isArray(value)||depth>128)throw new Error('FB2 XML层级或结构超限');const result:Fb2XmlNode[]=[];
  for(const item of value){if(++nodes>200000)throw new Error('FB2 XML节点数量超限');if(!record(item))throw new Error('FB2 XML节点无效');
   if(typeof item['#text']==='string'){result.push(cleanText(item['#text']));continue;}
   const names=Object.keys(item).filter(name=>name!==':@'&&!name.startsWith('?')&&!name.startsWith('#'));if(!names.length)continue;if(names.length!==1)throw new Error('FB2 XML元素结构无效');
   const rawAttributes=item[':@'];if(rawAttributes!==undefined&&!record(rawAttributes))throw new Error('FB2 XML属性无效');
   const attributes:Record<string,string>=Object.create(null);for(const [key,value]of Object.entries(rawAttributes??{})){if(typeof value!=='string')throw new Error('FB2 XML属性类型无效');attributes[key]=cleanText(value);}
   const scoped:Record<string,string>=Object.assign(Object.create(null),namespaces);for(const [key,value]of Object.entries(attributes)){if(key==='xmlns')scoped['']=value;else if(key.startsWith('xmlns:'))scoped[key.slice(6)]=value;}
   const name=names[0],split=name.split(':');if(split.length>2)throw new Error('FB2元素名称无效');const prefix=split.length===2?split[0]:'';if(prefix&&!Object.hasOwn(scoped,prefix))throw new Error('FB2命名空间前缀未声明');
   const attributeNamespaces:Record<string,string>=Object.create(null);for(const key of Object.keys(attributes)){if(key.startsWith('xmlns'))continue;const parts=key.split(':');if(parts.length>2||parts.length===2&&!Object.hasOwn(scoped,parts[0]))throw new Error('FB2属性命名空间未声明');attributeNamespaces[key]=parts.length===2?scoped[parts[0]]:'';}
   result.push({name:split.at(-1)!,namespace:scoped[prefix]??'',attributes,attributeNamespaces,children:convert(item[name],scoped,depth+1)});
  }return result;
 };
 const roots=convert(raw,{xml:'http://www.w3.org/XML/1998/namespace'},0),elements=roots.filter((node):node is Fb2XmlElement=>typeof node!=='string');
 if(elements.length!==1||elements[0].name!=='FictionBook'||![FB2_NAMESPACE,''].includes(elements[0].namespace)||roots.some(node=>typeof node==='string'&&node.trim()))throw new Error('文件不是FB2 FictionBook文档');return elements[0];
}
export const fb2Elements=(node:Fb2XmlElement,name?:string):Fb2XmlElement[]=>node.children.filter((child):child is Fb2XmlElement=>typeof child!=='string'&&(!name||child.name===name));
export const fb2Text=(node:Fb2XmlNode):string=>typeof node==='string'?node:node.children.map(fb2Text).join('');
export const fb2NormalizedText=(node:Fb2XmlNode):string=>fb2Text(node).replace(/\s+/gu,' ').trim();
