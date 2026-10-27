// @ts-check
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{path: string, bytes: number, sha256: string}} ReleaseFile */
/** @typedef {{schemaVersion: 1, distDir: string, sourceRevision: string, lockSha256: string, platform: string, architecture: string, nodeVersion: string, files: ReleaseFile[], totalBytes: number}} ReleaseManifest */

/** @param {string} value */
export function safeRelativePath(value) {
  if (!value || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error(`发布路径不安全：${value}`);
  }
  return value;
}

/** @param {string} relative */
export function excludedReleasePath(relative) {
  const parts = safeRelativePath(relative).split('/');
  // WHY：只剔除应用工程与秘密文件；依赖内部的 src 可能是运行入口，不能全局按目录名删代码。
  return relative.endsWith('.nft.json') || ['src', 'data', '.git', 'docs', 'prototypes'].includes(parts[0]) ||
    parts.some(part => part.startsWith('.env') || part === '.git' || part.startsWith('.verify-')) ||
    parts[0] === 'node_modules' && parts[1] === '.cache' ||
    parts.length > 1 && parts[0].startsWith('.next') && ['cache', 'dev', 'standalone', 'trace', 'trace-build'].includes(parts[1]);
}

/** @param {string} file */
export async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} root @param {string} [relative] @returns {Promise<ReleaseFile[]>} */
export async function inventoryRelease(root, relative = '') {
  /** @type {{path: string, bytes: number}[]} */
  const pending = [];
  /** @param {string} current */
  async function walk(current) {
    const entries = await readdir(path.join(root, current), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = current ? `${current}/${entry.name}` : entry.name;
      if (name === 'release-manifest.json') continue;
      safeRelativePath(name);
      if (excludedReleasePath(name)) throw new Error(`发布目录含禁止文件：${name}`);
      const info = await lstat(path.join(root, name));
      if (info.isSymbolicLink()) throw new Error(`发布目录不得依赖符号链接：${name}`);
      if (info.isDirectory()) await walk(name);
      else if (info.isFile()) pending.push({ path: name, bytes: info.size });
      else throw new Error(`发布目录含非普通文件：${name}`);
    }
  }
  await walk(relative);
  const result = [];
  // WHY：完整哈希不能省略；有界并行降低 Windows 数千个小文件逐一打开的启动开销，仍保留确定顺序与全部错误。
  for (let offset = 0; offset < pending.length; offset += 16) {
    result.push(...await Promise.all(pending.slice(offset, offset + 16).map(async file => ({ ...file, sha256: await fileSha256(path.join(root, file.path)) }))));
  }
  return result;
}

/** @param {string} distDir */
export function requiredReleaseFiles(distDir) {
  safeRelativePath(distDir);
  return ['server.js', 'start-release.mjs', 'release-manifest.mjs', 'package.json', `${distDir}/BUILD_ID`,
    'runtime/mobi/worker.cjs', 'runtime/mobi/manifest.json', 'runtime/mobi/THIRD_PARTY_NOTICES.txt',
    'runtime/umd/worker.cjs', 'runtime/umd/manifest.json', 'scripts/epub/foliate-import-worker.mjs',
    'public/vendor/foliate/epub.js', 'public/vendor/foliate/epubcfi.js', 'public/vendor/foliate/package.json', 'public/vendor/foliate/LICENSE',
    'public/vendor/pdfjs/pdf.worker.min.mjs', 'public/vendor/pdfjs/LICENSE', 'public/fonts/lxgw-wenkai/OFL.txt'];
}

/** @param {ReleaseFile[]} files @param {string} distDir */
export function validateRequiredFiles(files, distDir) {
  const names = new Set(files.map(file => file.path));
  for (const name of requiredReleaseFiles(distDir)) if (!names.has(name)) throw new Error(`发布缺少必要文件：${name}`);
  if (!files.some(file => file.path.startsWith(`${distDir}/static/`))) throw new Error('发布缺少 Next 静态资源');
}

/** @param {unknown} value @returns {asserts value is ReleaseManifest} */
function assertManifest(value) {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('distDir' in value) || typeof value.distDir !== 'string' || !('files' in value) || !Array.isArray(value.files) ||
    !('totalBytes' in value) || !Number.isSafeInteger(value.totalBytes) || !('sourceRevision' in value) || typeof value.sourceRevision !== 'string' ||
    !('lockSha256' in value) || typeof value.lockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.lockSha256) ||
    !('platform' in value) || typeof value.platform !== 'string' || !('architecture' in value) || typeof value.architecture !== 'string' ||
    !('nodeVersion' in value) || typeof value.nodeVersion !== 'string') throw new Error('发布清单格式不合法');
  safeRelativePath(value.distDir);
  const names = new Set();
  for (const item of value.files) {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
      typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('发布文件清单格式不合法');
    safeRelativePath(item.path);
    if (excludedReleasePath(item.path) || names.has(item.path)) throw new Error(`发布清单含禁止或重复路径：${item.path}`);
    names.add(item.path);
  }
}

/** @param {string} root */
export async function verifyRelease(root) {
  const value = /** @type {unknown} */ (JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8')));
  assertManifest(value);
  const actual = await inventoryRelease(root);
  validateRequiredFiles(actual, value.distDir);
  if (actual.length !== value.files.length) throw new Error('发布文件数量不匹配');
  const expected = new Map(value.files.map(file => [file.path, file]));
  for (const file of actual) {
    const entry = expected.get(file.path);
    if (!entry || entry.bytes !== file.bytes || entry.sha256 !== file.sha256) throw new Error(`发布文件校验失败：${file.path}`);
  }
  if (actual.reduce((sum, file) => sum + file.bytes, 0) !== value.totalBytes) throw new Error('发布总大小不匹配');
  return value;
}
