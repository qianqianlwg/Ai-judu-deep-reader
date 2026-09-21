// @ts-check
/** @typedef {{fid:number;start:number;end:number;targetStart:number}} FragmentSpan */
/** @typedef {{id:string;encoding:number;bytes:Uint8Array;fileStart?:number;spans?:FragmentSpan[],contextPrefix?:string,contextSuffix?:string,contextDepth?:number}} MobiSourceChapter */
const LIMIT=20_000_000;
/** @param {unknown} value @param {number} max @returns {number} */
function integer(value,max){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)throw new Error('MOBI来源整数无效');return value;}
/** 重建时同步追踪插入片段；不以解码后字符偏移代替原始字节。 @param {Uint8Array} skeleton @param {{fid:number;insertOffset:number;bytes:Uint8Array}[]} fragments */
export function reconstructKf8Source(skeleton,fragments){
 if(!(skeleton instanceof Uint8Array)||skeleton.length>LIMIT||!Array.isArray(fragments)||fragments.length>10000)throw new Error('KF8来源重建输入无效');
 let bytes=new Uint8Array(skeleton);
 /** @type {FragmentSpan[]} */
 let spans=[];const ids=new Set();let total=skeleton.length;
 for(const fragment of fragments){
  if(!fragment||!(fragment.bytes instanceof Uint8Array))throw new Error('KF8片段字节无效');
  const fid=integer(fragment.fid,0xffffffff),at=integer(fragment.insertOffset,bytes.length);if(ids.has(fid))throw new Error('KF8重复片段ID');ids.add(fid);
  total+=fragment.bytes.length;if(total>LIMIT)throw new Error('KF8重建正文超限');
  const amount=fragment.bytes.length;/** @type {FragmentSpan[]} */const next=[];
  for(const span of spans){const end=span.targetStart+span.end-span.start;
   if(end<=at)next.push(span);
   else if(span.targetStart>=at)next.push({...span,targetStart:span.targetStart+amount});
   else{const split=span.start+at-span.targetStart;next.push({...span,end:split},{...span,start:split,targetStart:at+amount});}
  }
  if(amount)next.push({fid,start:0,end:amount,targetStart:at});if(next.length>20000)throw new Error('KF8来源片段数超限');
  const output=new Uint8Array(total);output.set(bytes.subarray(0,at));output.set(fragment.bytes,at);output.set(bytes.subarray(at),at+amount);bytes=output;spans=next;
 }
 return {bytes,spans};
}
/** @param {Uint8Array} bytes @param {number} encoding */
export function decodeMobiSource(bytes,encoding){
 if(!(bytes instanceof Uint8Array)||bytes.length>LIMIT||![65001,1252].includes(encoding))throw new Error('MOBI来源编码或大小无效');
 // WHY：解码文本与后续字节边界核验必须绑定同一快照，不能被调用方修改输入后污染。
 bytes=new Uint8Array(bytes);
 const decoder=new TextDecoder(encoding===65001?'utf-8':'windows-1252',{fatal:true,ignoreBOM:true});
 const text=decoder.decode(bytes);
 /** @type {{byte:number,char:number}[]} */const checkpoints=[{byte:0,char:0}];
 if(encoding===65001){let at=0,char=0,last=0;while(at<bytes.length){const first=bytes[at],width=first<128?1:first<224?2:first<240?3:4;at+=width;char+=width===4?2:1;if(at-last>=1024){checkpoints.push({byte:at,char});last=at;}}}
 return {text,
 /** @param {number} offset */
 characterOffset(offset){
  if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length)return null;if(encoding===1252)return offset;
  let low=0,high=checkpoints.length-1;while(low<high){const middle=Math.ceil((low+high)/2);if(checkpoints[middle].byte<=offset)low=middle;else high=middle-1;}
  const checkpoint=checkpoints[low];
  // WHY：正文已一次严格解码；这里只在有界checkpoint内复核字节边界，截进UTF8编码则不能定位。
  try{return checkpoint.char+decoder.decode(bytes.subarray(checkpoint.byte,offset)).length;}catch(cause){if(cause instanceof TypeError)return null;throw cause;}
 }};
}
/** @param {string} href @returns {{kind:'mobi';offset:number}|{kind:'kf8';fid:number;offset:number}|null} */
export function parseMobiSourceLocator(href){
 if(typeof href!=='string'||href.length>256)return null;
 let match=/^filepos:(\d+)$/u.exec(href);if(match?.[0]===href){const offset=Number(match[1]);return Number.isSafeInteger(offset)&&offset>=0?{kind:'mobi',offset}:null;}
 match=/^kindle:pos:fid:([0-9a-v]+):off:([0-9a-v]+)$/iu.exec(href);if(match?.[0]!==href)return null;
 const fid=Number.parseInt(match[1],32),offset=Number.parseInt(match[2],32);
 return Number.isSafeInteger(fid)&&fid>=0&&fid<=0xffffffff&&Number.isSafeInteger(offset)&&offset>=0?{kind:'kf8',fid,offset}:null;
}
