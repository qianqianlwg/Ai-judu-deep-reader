import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { SupportedDocumentExtension } from "./document-adapter";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ORIGINAL_PATH = /^originals[\\/]([A-Za-z0-9][A-Za-z0-9_-]{0,127})(\.(?:epub|pdf|txt|md|fb2|fbz|cbz))$/u;
const RESERVED_ID = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;
const EXTENSIONS = new Set([".epub", ".pdf", ".txt", ".md", ".fb2", ".fbz", ".cbz"]);
export class OriginalFileError extends Error {
  constructor(readonly code: "UNSAFE_PATH" | "MISSING_FILE" | "CORRUPT_FILE", message: string) {
    super(message); this.name = "OriginalFileError";
  }
}
function unsafe(): never { throw new OriginalFileError("UNSAFE_PATH", "原文件路径不安全"); }
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function privateDataDir(value: string): string {
  const directory = path.resolve(value);
  const publicDir = path.resolve(process.cwd(), "public");
  const relative = path.relative(publicDir, directory);
  if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) unsafe();
  return directory;
}
export function getJuduDataDir(): string {
  return privateDataDir(process.env.JUDU_DATA_DIR || path.join(process.cwd(), "data"));
}
export function originalRelativePath(editionId: string, extension: SupportedDocumentExtension): string {
  if (SAFE_ID.exec(editionId)?.[0] !== editionId || RESERVED_ID.test(editionId)) throw new Error("版本 ID 不合法");
  if (!EXTENSIONS.has(extension)) unsafe();
  // WHY：数据库只存平台无关的相对路径；用户文件名永远不参与磁盘寻址。
  return `originals/${editionId}${extension}`;
}
function originalLocation(dataDir: string, relativePath: string) {
  const match = ORIGINAL_PATH.exec(relativePath);
  if (!match || match[0] !== relativePath || RESERVED_ID.test(match[1])) unsafe();
  const base = privateDataDir(dataDir);
  const directory = path.join(base, "originals");
  return { directory, absolutePath: path.join(directory, match[1] + match[2]) };
}
// WHY：逐级检查（包括数据根目录的祖先）以拒绝 junction/symlink；仅词法 startsWith 不能阻止链接逃逸。
async function checkedDirectory(directory: string, create = false): Promise<void> {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current, { mode: 0o700 }); }
      catch (error: unknown) { if (!hasCode(error, "EEXIST")) throw error; }
    }
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe();
  }
}
export type StoredOriginalFile = { relativePath: string; absolutePath: string; size: number; originalHash: string };
export async function storeOriginalFile(input: {
  dataDir?: string; editionId: string; extension: SupportedDocumentExtension; buffer: Uint8Array;
}): Promise<StoredOriginalFile> {
  // WHY：先复制调用方缓冲区，防止异步写入期间被外部修改，确保原字节与哈希来自同一快照。
  const buffer = Buffer.from(input.buffer);
  const relativePath = originalRelativePath(input.editionId, input.extension);
  const { directory, absolutePath } = originalLocation(input.dataDir ?? getJuduDataDir(), relativePath);
  await checkedDirectory(directory, true);
  const pending = path.join(directory, `.pending-${randomUUID()}`);
  const handle = await fs.open(pending, "wx", 0o600);
  let published = false;
  try {
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.chmod(0o400);
    await handle.close();
    await checkedDirectory(directory);
    // WHY：hard-link 发布是原子的且目标存在时失败；rename 在 POSIX 上会覆盖已保存的不可变原件。
    await fs.link(pending, absolutePath);
    published = true;
    await fs.rm(pending);
    return { relativePath, absolutePath, size: buffer.byteLength, originalHash: createHash("sha256").update(buffer).digest("hex") };
  } catch (error: unknown) {
    const failures: unknown[] = [error];
    try { await handle.close(); } catch (closeError: unknown) { failures.push(closeError); }
    try {
      await checkedDirectory(directory);
      await fs.rm(pending, { force: true });
      if (published) await fs.rm(absolutePath, { force: true });
    } catch (cleanupError: unknown) {
      failures.push(cleanupError);
    }
    if (failures.length > 1) throw new AggregateError(failures, "原文件写入及清理失败");
    throw error;
  }
}
export async function removeStoredOriginalFile(dataDir: string, relativePath: string): Promise<void> {
  const { directory, absolutePath } = originalLocation(dataDir, relativePath);
  try {
    await checkedDirectory(directory);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) unsafe();
    await fs.rm(absolutePath);
  } catch (error: unknown) { if (!hasCode(error, "ENOENT")) throw error; }
}
export async function readStoredOriginalFile(input: {
  dataDir?: string; relativePath: string; size: number; originalHash: string;
}): Promise<Buffer> {
  const { directory, absolutePath } = originalLocation(input.dataDir ?? getJuduDataDir(), input.relativePath);
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.originalHash.length !== 64 || !/^[a-f0-9]{64}$/u.test(input.originalHash)) {
    throw new OriginalFileError("CORRUPT_FILE", "原文件完整性元数据缺失或损坏，请重新导入");
  }
  try {
    await checkedDirectory(directory);
    const before = await fs.lstat(absolutePath);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) unsafe();
    const handle = await fs.open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) unsafe();
      if (opened.size !== input.size) throw new OriginalFileError("CORRUPT_FILE", "原文件大小不匹配，请重新导入");
      const buffer = await handle.readFile();
      await checkedDirectory(directory);
      if (buffer.byteLength !== input.size || createHash("sha256").update(buffer).digest("hex") !== input.originalHash) {
        throw new OriginalFileError("CORRUPT_FILE", "原文件校验失败，请重新导入");
      }
      return buffer;
    } finally { await handle.close(); }
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) throw new OriginalFileError("MISSING_FILE", "原文件已丢失，请重新导入");
    if (hasCode(error, "ELOOP")) unsafe();
    throw error;
  }
}
