import type { EpubArchive } from './foliate-types';

export const EPUB_LIMITS = Object.freeze({
  compressed: 64 * 1024 * 1024, entry: 24 * 1024 * 1024,
  total: 128 * 1024 * 1024, entries: 4096, ratio: 200, text: 2 * 1024 * 1024,
});
export interface ZipRecord { name: string; compressed: number; size: number; directory: boolean }

export function assertPackagePath(path: string): string {
  if (!path || path.length > 1024 || /[\\%:#?\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/'))
    throw new Error(`EPUB 不安全的 ZIP 路径：${path}`);
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || path !== path.normalize('NFC'))
    throw new Error(`EPUB 非规范 ZIP 路径：${path}`);
  return path;
}

export interface PackageReference { path: string; fragment: string }
export function resolvePackageReference(value: string, base: string): PackageReference | null {
  if (!value || value !== value.trim() || /[\\\u0000-\u0020\u007f]/u.test(value)
      || value.startsWith('/') || /^[^/#]*:/u.test(value) || value.includes('?')) return null;
  const hash = value.indexOf('#');
  const raw = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? '' : value.slice(hash);
  if (/[<>"'`]/u.test(fragment)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; /* Invalid URL is intentionally blocked. */ }
  if (/%2f|%5c/i.test(raw) || /[\\%:#?\u0000-\u001f\u007f]/u.test(decoded)) return null;
  if (!raw) return { path: base, fragment };
  const parts = base.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
    else if (!part) return null;
  }
  const path = parts.join('/');
  return path ? { path, fragment } : null;
}

export async function inspectZip(blob: Blob, format: "epub" | "fbz" | "cbz" = "epub"): Promise<Map<string, ZipRecord>> {
  if (!blob.size || blob.size > EPUB_LIMITS.compressed) throw new Error('EPUB 压缩文件超过 64 MiB 限制');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('EPUB ZIP 结束记录无效');
  // WHY：与服务端和实际ZIP解码器一致选择最后一个EOCD，拒绝comment中嵌入另一归档造成双解析器分歧。
  for(let at=bytes.length-4;at>end;at--)if(u32(at)===0x06054b50)throw new Error('ZIP 结束记录存在歧义');
  const count = u16(end + 10), length = u32(end + 12), start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count
      || count > EPUB_LIMITS.entries || start + length !== end || start === 0xffffffff)
    throw new Error('EPUB ZIP64、分卷或目录大小不受支持');
  const records = new Map<string, ZipRecord>(), ranges: [number, number][] = [];
  let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) throw new Error('EPUB ZIP 目录损坏');
    const flags = u16(pos + 8), method = u16(pos + 10), compressed = u32(pos + 20), size = u32(pos + 24);
    const nameLength = u16(pos + 28), extra = u16(pos + 30), comment = u16(pos + 32), local = u32(pos + 42);
    const next = pos + 46 + nameLength + extra + comment;
    if (next > end || local + 30 > start || u32(local) !== 0x04034b50)
      throw new Error('EPUB ZIP 条目边界无效');
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLength);
    if (!(flags & 2048) && nameBytes.some(byte => byte > 127)) throw new Error('EPUB ZIP 文件名必须使用 UTF-8');
    const name = assertPackagePath(new TextDecoder('utf-8', { fatal: true }).decode(nameBytes));
    const directory = name.endsWith('/');
    if (records.has(name) || records.has(directory ? name.slice(0, -1) : `${name}/`))
      throw new Error(`EPUB ZIP 重复路径：${name}`);
    const localNameLength = u16(local + 26), localExtra = u16(local + 28);
    const data = local + 30 + localNameLength + localExtra;
    if (u16(pos + 34) || flags & 1 || ![0, 8].includes(method) || flags & ~(2048 | 8 | 6)
        || u16(local + 6) !== flags || u16(local + 8) !== method || data + compressed > start
        || localNameLength !== nameLength || nameBytes.some((b, j) => b !== bytes[local + 30 + j]))
      throw new Error('EPUB ZIP 加密、压缩方法或本地文件头无效');
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== size
        || u32(local + 14) !== u32(pos + 16))) throw new Error('EPUB ZIP 本地大小不一致');
    total += size;
    if (size > EPUB_LIMITS.entry || total > EPUB_LIMITS.total || size > Math.max(1, compressed) * EPUB_LIMITS.ratio
        || (directory && (size || compressed)) || (method === 0 && size !== compressed))
      throw new Error('EPUB ZIP 解压大小或压缩比超过限制');
    if (format === 'epub' && i === 0 && (name !== 'mimetype' || local !== 0 || method || localExtra || flags & 8))
      throw new Error('EPUB mimetype 必须是第一个未压缩、无额外字段的条目');
    ranges.push([local, data + compressed]);
    records.set(name, { name, compressed, size, directory });
    pos = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (pos !== end || ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1]))
    throw new Error('EPUB ZIP 目录或条目重叠');
  return records;
}

export function validateArchive(archive: EpubArchive, records: Map<string, ZipRecord>): void {
  if (archive.entries.length !== records.size) throw new Error('EPUB ZIP 解码目录不一致');
  const seen = new Set<string>();
  for (const entry of archive.entries) {
    const record = records.get(entry.filename);
    if (!record || seen.has(entry.filename) || entry.encrypted || record.directory !== entry.directory
        || record.size !== entry.uncompressedSize || record.compressed !== entry.compressedSize)
      throw new Error('EPUB ZIP 路径解码、大小或加密状态不一致');
    seen.add(entry.filename);
  }
}
