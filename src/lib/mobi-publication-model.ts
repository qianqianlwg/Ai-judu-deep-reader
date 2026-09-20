import { z } from "zod";
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const resourceId = z.string().max(512).regex(/^mobi-resource-v1\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|svg|css)$/u);
const path = z.array(z.number().int().min(0).max(100000)).min(1).max(128);
const point = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("element"),path,tag:z.string().max(128),offset:z.literal(0)}).strict(),
  z.object({kind:z.literal("text"),path,offset:z.number().int().min(0),textLength:z.number().int().min(0).max(8*1024*1024),textHash:hash}).strict(),
]);
const chapter = z.object({id:z.string().min(1).max(1024),title:z.string().max(4096),html:z.string().max(8*1024*1024),head:z.string().max(8*1024*1024),htmlHash:hash}).strict();
const schema = z.object({
  schema:z.literal("mobi-publication-v1"),sourceHash:hash,layoutHash:hash,title:z.string().max(4096),authors:z.array(z.string().max(4096)).max(256),
  chapters:z.array(chapter).min(1).max(10000),
  resources:z.array(z.object({id:resourceId,mediaType:z.enum(["image/jpeg","image/png","image/gif","image/svg+xml","text/css"]),base64:z.string().min(1).max(140*1024*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/u).refine(value=>value.length%4===0&&!value.endsWith("\n")),hash}).strict()).max(5000),
  navigation:z.array(z.object({href:z.string().regex(/^#judu-mobi-locator-[0-9a-f]{64}$/u),chapterId:z.string().min(1).max(1024),point}).strict()).max(20000),
  toc:z.array(z.object({label:z.string().max(4096),href:z.string().max(1200),depth:z.number().int().min(0).max(128)}).strict()).max(10000),
  warnings:z.array(z.string().max(512)).max(20),
}).strict();
export type MobiPublication = z.infer<typeof schema>;
export type MobiPublicationPoint = MobiPublication["navigation"][number]["point"];
/** WHY：只验证应用私有布局API的协议和身份；本函数不是任意HTML的净化器，原件绝不能直接套此结构渲染。 */
export function readMobiPublication(value:unknown,sourceHash:string):MobiPublication {
  const result=schema.parse(value);
  if(result.sourceHash!==sourceHash)throw new Error("MOBI原版来源与当前版本不一致");
  const ids=new Set(result.chapters.map(c=>c.id)),resources=new Set(result.resources.map(r=>r.id)),links=new Set(result.navigation.map(n=>n.href));
  if(ids.size!==result.chapters.length||resources.size!==result.resources.length||links.size!==result.navigation.length)throw new Error("MOBI原版存在重复标识");
  let chars=0,bytes=0;
  for(const c of result.chapters){if(!/^mobi-v1\/(?:mobi|kf8)\/[^#?]+$/u.test(c.id))throw new Error("MOBI章节来源无效");chars+=c.html.length+c.head.length;}
  if(chars>40_000_000)throw new Error("MOBI原版文字超限");
  const types:Record<string,string>={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",svg:"image/svg+xml",css:"text/css"};
  for(const r of result.resources){bytes+=r.base64.length;if(types[r.id.split('.').at(-1)!]!==r.mediaType)throw new Error("MOBI资源类型不一致");}
  if(bytes>140*1024*1024)throw new Error("MOBI原版资源超限");
  for(const n of result.navigation){if(!ids.has(n.chapterId)||(n.point.kind==="text"&&n.point.offset>n.point.textLength))throw new Error("MOBI导航归属无效");}
  for(const t of result.toc)if(!links.has(t.href)&&!ids.has(t.href))throw new Error("MOBI目录目标无效");
  return result;
}
