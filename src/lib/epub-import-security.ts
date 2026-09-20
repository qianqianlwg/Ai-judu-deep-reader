import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { EPUB_LIMITS } from "./epub-security-zip";
const inflate = promisify(inflateRaw);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const checksum = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; };
export class EpubImportSecurityError extends Error { constructor(message: string) { super(message); this.name = "EpubImportSecurityError"; } }
function reject(message: string): never { throw new EpubImportSecurityError("EPUB 安全检查失败：" + message); }
type Entry = { name: string; start: number; end: number; method: number; size: number; crc: number };
function inspect(bytes: Buffer, epub = true): Entry[] {
  if (bytes.length < 22 || bytes.length > EPUB_LIMITS.compressed) reject("压缩文件应小于等于 64 MiB");
  const u16 = (offset: number) => bytes.readUInt16LE(offset), u32 = (offset: number) => bytes.readUInt32LE(offset);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { eocd = at; break; }
  }
  if (eocd < 0) reject("ZIP 结束记录无效");
  // WHY：JSZip 取最后一个 EOCD 签名且容忍尾随字节；必须与预检选择同一记录，否则 comment 内嵌归档可绕过限额。
  if (bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06])) !== eocd) reject("ZIP 结束记录存在歧义");
  const count = u16(eocd + 10), start = u32(eocd + 16), length = u32(eocd + 12);
  if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== count || !count || count > EPUB_LIMITS.entries
      || start + length !== eocd || start === 0xffffffff) reject("ZIP64、分卷、条目数量或目录边界不受支持");
  const entries: Entry[] = [], names = new Set<string>(), ranges: [number, number][] = [];
  let at = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || u32(at) !== 0x02014b50) reject("ZIP 目录损坏");
    const flags = u16(at + 8), method = u16(at + 10), compressed = u32(at + 20), size = u32(at + 24);
    const nameLength = u16(at + 28), local = u32(at + 42), next = at + 46 + nameLength + u16(at + 30) + u16(at + 32);
    if (next > eocd || local + 30 > start || u32(local) !== 0x04034b50) reject("条目边界无效");
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    let name: string;
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes); }
    catch { reject("ZIP 文件名编码无效"); }
    // WHY：旧 EPUB parser 按字面 ZIP 名寻址（包括 %），这里不做 URL 解码且不解包到磁盘；前端资源解析仍使用更严格 URL 策略。
    const parts = name.replace(/\/$/u, "").split("/");
    if (!name || name.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(name) || name.startsWith("/")
        || parts.some(part => !part || part === "." || part === "..") || names.has(name)
        || names.has(name.endsWith("/") ? name.slice(0, -1) : name + "/")) reject("路径重复或不安全");
    names.add(name);
    const localNameLength = u16(local + 26), data = local + 30 + localNameLength + u16(local + 28), end = data + compressed;
    if (u16(at + 34) || flags & 1 || flags & ~(2048 | 8 | 6) || ![0, 8].includes(method)
        || u16(local + 6) !== flags || u16(local + 8) !== method || end > start || data > start
        || localNameLength !== nameLength || !nameBytes.equals(bytes.subarray(local + 30, local + 30 + localNameLength))) reject("本地文件头或压缩方法无效");
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== size || u32(local + 14) !== u32(at + 16))) reject("本地大小或校验和不一致");
    total += size;
    if (size > EPUB_LIMITS.entry || total > EPUB_LIMITS.total || size > Math.max(1, compressed) * EPUB_LIMITS.ratio
        || (name.endsWith("/") && (size || compressed)) || (method === 0 && size !== compressed)) reject("解压大小或压缩比超过限制");
    if (epub && i === 0 && (name !== "mimetype" || local !== 0 || method || u16(local + 28) || flags & 8)) reject("mimetype 必须是首个未压缩条目");
    entries.push({ name, start: data, end, method, size, crc: u32(at + 16) }); ranges.push([local, end]); at = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (at !== eocd || ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1][1])) reject("ZIP 条目重叠");
  return entries;
}

/** Must run BEFORE the legacy EPUB parser; the same immutable bytes are then written to its private temp file. */
export async function visitValidatedZip(bytes: Buffer, epub: boolean, visit: (name:string,bytes:Buffer)=>void|Promise<void>): Promise<void> {
  const entries = inspect(bytes,epub);
  let total = 0;
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.start, entry.end);
    let output: Buffer;
    // WHY：在 zlib 原生输出累计期间强制上限，不等 JSZip 完整解压后才检查声明大小；每次仅保留一个有界条目。
    try { output = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: Math.max(1, Math.min(entry.size, EPUB_LIMITS.entry, EPUB_LIMITS.total - total)) }); }
    catch (cause: unknown) { throw new EpubImportSecurityError("EPUB 解压内容无效或实际输出超过限制：" + (cause instanceof Error ? cause.name : "未知错误")); }
    total += output.byteLength;
    if (output.byteLength !== entry.size || total > EPUB_LIMITS.total || checksum(output) !== entry.crc) reject("实际解压大小或 CRC 校验不一致");
    if (epub && entry.name === "mimetype" && output.toString("utf8") !== "application/epub+zip") reject("mimetype 内容无效");
    await visit(entry.name,output);
  }
}

export async function validateEpubImport(bytes:Buffer):Promise<void>{await visitValidatedZip(bytes,true,()=>{});}

/** WHY：已经完整核验并按SHA256保存的原件，按需仅解压目标页；仍重新检查整个目录和目标页真实大小/CRC，不提取路径到磁盘。 */
export async function readValidatedZipEntry(bytes:Buffer,name:string):Promise<Buffer>{
 const entry=inspect(bytes,false).find(entry=>entry.name===name);if(!entry||entry.name.endsWith('/'))throw new Error('ZIP目标条目不存在');
 const compressed=bytes.subarray(entry.start,entry.end);let output:Buffer;
 try{output=entry.method===0?compressed:await inflate(compressed,{maxOutputLength:Math.max(1,Math.min(entry.size,EPUB_LIMITS.entry))});}
 catch(cause:unknown){throw new EpubImportSecurityError('ZIP目标条目解压失败或输出超限：'+(cause instanceof Error?cause.name:'未知错误'));}
 if(output.length!==entry.size||checksum(output)!==entry.crc)reject('ZIP目标条目实际大小或CRC不一致');return output;
}
