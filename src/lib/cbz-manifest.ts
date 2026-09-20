export const CBZ_MAX_PAGES=1000;
export type CbzEntry={name:string;directory:boolean};
export type CbzPage={page:number;name:string;sourceHref:string;title:string};
export const isCbzFormat=(format:string):boolean=>format.replace(/^\./u,'').toLowerCase()==='cbz';
export function cbzSourceHref(name:string):string{return 'cbz-v1/'+encodeURIComponent(name);}
function compareNames(a:string,b:string):number{
 const left=a.normalize('NFC').toLowerCase().match(/\d+|\D+/gu)??[],right=b.normalize('NFC').toLowerCase().match(/\d+|\D+/gu)??[];
 for(let i=0;i<Math.min(left.length,right.length);i++){const x=left[i],y=right[i];if(x===y)continue;if(/^\d/u.test(x)&&/^\d/u.test(y)){const nx=x.replace(/^0+(?=\d)/u,''),ny=y.replace(/^0+(?=\d)/u,'');if(nx.length!==ny.length)return nx.length-ny.length;if(nx!==ny)return nx<ny?-1:1;}else return x<y?-1:1;}
 if(left.length!==right.length)return left.length-right.length;return a===b?0:a<b?-1:1;
}
export function cbzPages(entries:readonly CbzEntry[]):CbzPage[]{
 const files=entries.filter(entry=>!entry.directory),names=new Set<string>(),pages:string[]=[];
 for(const {name}of files){if(names.has(name))throw new Error('CBZ归档存在重复文件名');names.add(name);
  if(name.startsWith('__MACOSX/')||name.split('/').at(-1)==='.DS_Store'||name.split('/').at(-1)==='Thumbs.db')continue;
  if(/\.(?:jpe?g|png|gif|webp)$/iu.test(name)){pages.push(name);continue;}
  // WHY：仅忽略已知非正文元数据，不执行XML或任意文件；其他容器/文档不当作漫画页。
  if(name==='ComicInfo.xml'||name.split('/').at(-1)==='.DS_Store'||name.startsWith('__MACOSX/')||name.split('/').at(-1)==='Thumbs.db')continue;
  throw new Error('CBZ包含不支持的文件：'+name);
 }
 if(!pages.length)throw new Error('CBZ没有支持的图片页');if(pages.length>CBZ_MAX_PAGES)throw new Error('CBZ图片页超过1000页上限');
 return pages.sort(compareNames).map((name,index)=>({page:index+1,name,sourceHref:cbzSourceHref(name),title:'第 '+(index+1)+' 页 · '+name.split('/').at(-1)}));
}
