// @ts-check
import { lstat, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { excludedReleasePath, safeRelativePath } from './release-manifest.mjs';

/** @param {string} parent @param {string} child */
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** @param {string} directory @returns {Promise<string[]>} */
async function traceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['standalone', 'cache', 'static', 'dev'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`追踪目录不得包含链接：${file}`);
    if (entry.isDirectory()) files.push(...await traceFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.nft.json')) files.push(file);
  }
  return files;
}

/** @param {string} root @param {string} distDir */
export async function collectReleaseTraces(root, distDir) {
  const files = new Set(); let omittedHostFiles = 0;
  const traces = await traceFiles(path.join(root, distDir));
  if (!traces.length) throw new Error('缺少 Next 文件追踪清单');
  for (const trace of traces) {
    const value = /** @type {unknown} */ (JSON.parse(await readFile(trace, 'utf8')));
    if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files)) throw new Error('追踪清单格式错误');
    for (const item of value.files) {
      if (typeof item !== 'string') throw new Error('追踪文件路径格式错误');
      // WHY：Windows 跨盘临时路径可能被 NFT 写成 ../../C:/...；只识别已知系统临时目录，其他越界一律报错。
      const drive = item.replaceAll('\\', '/').match(/(?:^|\/)([A-Za-z]:\/.*)$/)?.[1];
      const source = drive ? path.resolve(drive) : path.resolve(path.dirname(trace), item);
      if (!inside(root, source)) {
        if (inside(os.tmpdir(), source)) { omittedHostFiles++; continue; }
        throw new Error(`追踪文件越出项目边界：${item}`);
      }
      const relative = path.relative(root, source).replaceAll('\\', '/');
      safeRelativePath(relative);
      if (excludedReleasePath(relative)) { omittedHostFiles++; continue; }
      files.add(relative);
    }
  }
  return { files: [...files].sort(), traceCount: traces.length, omittedHostFiles };
}

/** @param {string} root @param {string[]} files */
export async function collectDependencyNotices(root, files) {
  const packages = new Set(); const notices = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] !== 'node_modules') continue;
      const count = parts[i + 1].startsWith('@') ? i + 3 : i + 2;
      packages.add(parts.slice(0, count).join('/'));
    }
  }
  /** @param {string} relative */
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`依赖许可目录含链接：${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile() && /^(licen[cs]e|notice|copying|copyright|third[_-]party[_-]notices?)([. _-]|$)/i.test(entry.name)) notices.add(name);
    }
  }
  for (const pkg of [...packages].sort()) {
    if (!(await lstat(path.join(root, pkg))).isDirectory()) throw new Error(`依赖目录异常：${pkg}`);
    await walk(pkg);
  }
  return [...notices].sort();
}

/** @param {string} root @param {string[]} names */
export async function collectRuntimePackages(root, names) {
  const packages = new Set();
  /** @param {string} name @param {string} parent @param {boolean} [optional] */
  async function visit(name, parent, optional = false) {
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error('运行依赖名称不合法');
    const search = createRequire(path.join(parent, 'package.json')).resolve.paths(name + "/package.json") ?? [];
    for (const directory of search) {
      const pkg = path.join(directory, name); let content;
      try { content = await readFile(path.join(pkg, 'package.json'), 'utf8'); }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error; }
      if (!inside(root, pkg)) throw new Error(`运行依赖越出项目边界：${name}`);
      if (packages.has(pkg)) return;
      const value = /** @type {unknown} */ (JSON.parse(content));
      if (!value || typeof value !== 'object' || !('name' in value) || value.name !== name) throw new Error(`运行依赖元数据不合法：${name}`);
      packages.add(pkg);
      const metadata = /** @type {Record<string, unknown>} */ (value);
      for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        const deps = metadata[kind];
        if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
        for (const dep of Object.keys(deps)) {
          // WHY：外部 EPUB 子进程不经过 Webpack，按真实安装位置携带生产依赖闭包；缺失的可选 peer 不扩大产品能力。
          const peers = metadata.peerDependenciesMeta;
          const peer = peers && typeof peers === 'object' && dep in peers ? /** @type {Record<string, unknown>} */ (peers)[dep] : undefined;
          const isOptionalPeer = peer && typeof peer === 'object' && 'optional' in peer && peer.optional === true;
          await visit(dep, pkg, kind === 'optionalDependencies' || kind === 'peerDependencies' && Boolean(isOptionalPeer));
        }
      }
      return;
    }
    if (!optional) throw new Error(`缺少外部 worker 运行依赖：${name}`);
  }
  for (const name of names) await visit(name, root);
  return [...packages].map(pkg => path.relative(root, pkg).replaceAll('\\', '/')).sort();
}

/** @param {string} root */
export async function collectBundledDependencyNotices(root) {
  const lock = /** @type {unknown} */ (JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')));
  if (!lock || typeof lock !== 'object' || !('packages' in lock) || !lock.packages || typeof lock.packages !== 'object') throw new Error('依赖锁缺少 packages 清单');
  const packages = [];
  for (const [name, value] of Object.entries(lock.packages)) {
    if (!name.startsWith('node_modules/') || !value || typeof value !== 'object' || value.dev === true) continue;
    safeRelativePath(name);
    try {
      const info = await lstat(path.join(root, name));
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`生产依赖许可目录异常：${name}`);
    } catch (error) {
      // WHY：锁文件包括未安装的其他平台可选原生包；只跳过确实不存在的目录，权限或链接错误必须上抛。
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    packages.push(`${name}/package.json`);
  }
  // WHY：Webpack 内嵌依赖未必出现在 NFT 文件闭包；仅补其许可证，不把整个生产/开发依赖目录复制进来。
  return collectDependencyNotices(root, packages);
}
