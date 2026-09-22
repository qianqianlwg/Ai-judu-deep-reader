import {EPub} from "epub";
import sharp from "sharp";
import {promises as fs} from "node:fs";
import path from "node:path";
import {validateEpubImport} from "./epub-import-security";
import {getJuduDataDir} from "./data-storage";
import {loadPdfJs} from "./document-adapter";

type NodeCanvas = HTMLCanvasElement & {toBuffer(type: "image/png"): Buffer};
type CanvasSurface = {canvas: NodeCanvas; context: CanvasRenderingContext2D};
type CanvasFactory = {create(width:number,height:number):CanvasSurface;destroy(surface:CanvasSurface):void};
async function pdfCover(buffer: Buffer): Promise<Buffer> {
  const resources=path.join(process.cwd(),"public","vendor","pdfjs");
  const task=loadPdfJs().getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,maxImageSize:16_777_216,
    cMapUrl:path.join(resources,"cmaps").replaceAll("\\","/")+"/",cMapPacked:true,standardFontDataUrl:path.join(resources,"standard_fonts").replaceAll("\\","/")+"/",
    wasmUrl:path.join(resources,"wasm").replaceAll("\\","/")+"/"});
  try {
    const document=await task.promise;const page=await document.getPage(1);
    const base=page.getViewport({scale:1});
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width<=0 || base.height<=0) throw new Error("PDF 首页尺寸无效");
    const viewport=page.getViewport({scale:Math.min(320/base.width,440/base.height)});
    const candidate: unknown=document.canvasFactory;
    if (!candidate || typeof candidate!=="object" || !("create" in candidate) || typeof candidate.create!=="function" || !("destroy" in candidate) || typeof candidate.destroy!=="function") throw new Error("PDF 缩略图画布不可用");
    const factory=candidate as CanvasFactory;
    const surface=factory.create(Math.max(1,Math.ceil(viewport.width)),Math.max(1,Math.ceil(viewport.height)));
    try {
      await page.render({canvas:surface.canvas,canvasContext:surface.context,viewport}).promise;
      return surface.canvas.toBuffer("image/png");
    } finally {factory.destroy(surface);page.cleanup();}
  } finally {await task.destroy();}
}
export async function renderBookCover(bytes: Buffer, format: ".epub" | ".pdf"): Promise<Buffer | null> {
  let image: Buffer;
  if (format === ".pdf") image=await pdfCover(bytes);
  else {
    await validateEpubImport(bytes);
    const book=new EPub(bytes);await book.parse();
    const id=typeof book.metadata.cover==="string" ? book.metadata.cover : Object.values(book.manifest).find(item => typeof item.properties==="string" && item.properties.split(/\s+/u).includes("cover-image"))?.id;
    if (!id) return null;
    const cover=await book.getImage(id);
    // WHY：只解码本地栅格封面，不直接返回 SVG/HTML，也不跟随书籍中的远端图片 URL。
    if (!/^image\/(?:png|jpeg|jpg|webp|gif|avif)$/iu.test(cover.mimeType)) return null;
    image=cover.data;
  }
  const decoder=sharp(image,{limitInputPixels:16_777_216,animated:false});
  const metadata=await decoder.metadata();
  // WHY：不信任 EPUB 声明的 MIME；伪装为 JPEG 的 SVG 也不能进入渲染。
  if (!metadata.format || !["png","jpeg","webp","gif","avif","heif"].includes(metadata.format)) return null;
  return decoder.rotate().resize({width:320,height:440,fit:"inside",withoutEnlargement:true}).webp({quality:80}).toBuffer();
}
const pending=new Map<string,Promise<Buffer|null>>();
let queue: Promise<unknown>=Promise.resolve();
const missing=(cause:unknown)=>cause instanceof Error && "code" in cause && cause.code==="ENOENT";
export async function cachedBookCover(hash:string,render:()=>Promise<Buffer|null>,dataDir=getJuduDataDir()):Promise<Buffer|null> {
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("封面来源指纹无效");
  const root=await fs.realpath(dataDir);const directory=path.join(root,"covers-v1");
  await fs.mkdir(directory,{recursive:true});
  if ((await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory)!==directory) throw new Error("封面缓存目录不安全");
  const file=path.join(directory,hash+".webp");
  try {
    const stat=await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>1_000_000) throw new Error("封面缓存文件无效");
    return await fs.readFile(file);
  } catch (cause:unknown) {if (!missing(cause)) throw cause;}
  const existing=pending.get(file);if(existing)return existing;
  if (pending.size>=16) throw new Error("封面生成队列已满，请稍后重试");
  // WHY：缩略图独立于导入，按需生成并按内容指纹缓存；串行渲染避免大量 PDF 同时占用内存。
  const work=queue.then(async()=>{
    const image=await render();
    if(image) await fs.writeFile(file,image,{flag:"wx"}).catch((cause:unknown)=>{if (!(cause instanceof Error && "code" in cause && cause.code==="EEXIST")) throw cause;});
    return image;
  }).finally(()=>{pending.delete(file);});
  pending.set(file,work);queue=work.catch((cause:unknown)=>{console.warn("封面任务失败，后续任务继续",cause);});
  return work;
}
