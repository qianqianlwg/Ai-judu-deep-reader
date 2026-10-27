// @ts-check
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBundledDependencyNotices, collectDependencyNotices, collectReleaseTraces, collectRuntimePackages } from './release-traces.mjs';
import { excludedReleasePath, fileSha256, inventoryRelease, safeRelativePath, validateRequiredFiles, verifyRelease } from './release-manifest.mjs';

/** @param {string} source @param {string} destination @param {string} [relative] */
export async function copyReleaseTree(source, destination, relative = '') {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`拒绝复制符号链接：${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of (await readdir(source)).sort()) {
      const name = relative ? `${relative}/${entry}` : entry;
      if (!excludedReleasePath(name)) await copyReleaseTree(path.join(source, entry), path.join(destination, entry), name);
    }
  } else if (info.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
    catch (error) {
      // WHY：Next 已追踪的 public 文件与完整静态目录会重叠，只允许相同字节合并，禁止覆盖异内容。
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST' ||
        await fileSha256(source) !== await fileSha256(destination)) throw error;
    }
  } else throw new Error(`拒绝复制非普通文件：${source}`);
}

/** @param {string} root @param {string} output */
export function validateOutputDirectory(root, output) {
  const source = path.resolve(root), destination = path.resolve(output);
  const relative = path.relative(source, destination);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) && path.relative(destination, source).startsWith('..') === false) throw new Error('发布目录不得覆盖源码目录或其祖先');
  // WHY：仓库内只允许写入已忽略的 build；绝不把发布结果写进正式 data 或运行中的 .next。
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== 'build') throw new Error('仓库内发布目录只能位于 build 下');
  return destination;
}

/** @param {string} destination */
export async function rejectLinkedAncestors(destination) {
  let current = path.resolve(destination);
  while (true) {
    try {
      const info = await lstat(current);
      // WHY：词法上位于 build 不代表真实写入也在 build；拒绝 junction/symlink 祖先，避免发布文件落入正式 data。
      if (info.isSymbolicLink()) throw new Error("发布路径含符号链接祖先：" + current);
      if (!info.isDirectory()) throw new Error("发布目录祖先不是目录：" + current);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** @param {{root: string, distDir?: string, outputDir: string, sourceRevision: string}} options */
export async function packageRelease(options) {
  const root = path.resolve(options.root), distDir = options.distDir ?? '.next';
  safeRelativePath(distDir);
  if (distDir.includes('/')) throw new Error('构建目录必须是项目根目录下的单层目录');
  const output = validateOutputDirectory(root, options.outputDir);
  await rejectLinkedAncestors(path.dirname(output));
  // WHY：预先以排他 mkdir 保留目标，拒绝覆盖任何现有版本；失败保留不完整目录便于诊断，不递归删除用户路径。
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  const pending = path.join(output, '.incomplete');
  await writeFile(pending, '发布未完成，不得启动\n', { flag: 'wx' });
  const standalone = path.join(root, distDir, 'standalone');
  // WHY：按 Next 文档消费 NFT 清单，修复 Windows 自动复制提前失败；只复制项目内运行闭包，不修改框架或业务依赖。
  const traces = await collectReleaseTraces(root, distDir);
  await copyReleaseTree(standalone, output);
  const runtimePackages = await collectRuntimePackages(root, ['jsdom', 'jszip']);
  for (const pkg of runtimePackages) await copyReleaseTree(path.join(root, pkg), path.join(output, pkg), pkg);
  const notices = [...await collectDependencyNotices(root, traces.files), ...await collectBundledDependencyNotices(root)];
  for (const file of [...new Set([...traces.files, ...notices])]) await copyReleaseTree(path.join(root, file), path.join(output, file), file);
  for (const [source, destination] of [
    ['public', 'public'], ['runtime/mobi', 'runtime/mobi'], ['runtime/umd', 'runtime/umd'], ['scripts/epub', 'scripts/epub'], [`${distDir}/static`, `${distDir}/static`],
  ]) await copyReleaseTree(path.join(root, source), path.join(output, destination), destination);
  for (const name of ['start-release.mjs', 'release-manifest.mjs']) await copyReleaseTree(path.join(root, 'scripts', name), path.join(output, name), name);
  const files = await inventoryRelease(output);
  // WHY：不完整标记只用于失败诊断，不计入可启动发布；正式清单生成后才原子移除。
  const entries = files.filter(file => file.path !== '.incomplete');
  validateRequiredFiles(entries, distDir);
  const manifest = { schemaVersion: /** @type {const} */ (1), distDir, sourceRevision: options.sourceRevision,
    lockSha256: await fileSha256(path.join(root, 'package-lock.json')), platform: process.platform,
    architecture: process.arch, nodeVersion: process.version, files: entries, totalBytes: entries.reduce((sum, file) => sum + file.bytes, 0) };
  await writeFile(path.join(output, 'release-manifest.json.pending'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await rename(path.join(output, 'release-manifest.json.pending'), path.join(output, 'release-manifest.json'));
  const { unlink } = await import('node:fs/promises');
  await unlink(pending);
  await verifyRelease(output);
  return { directory: output, manifest };
}

/** @param {string[]} args */
export function releaseArguments(args) {
  const result = { distDir: '.next-release', outputDir: '', sourceRevision: process.env.JUDU_SOURCE_REVISION ?? 'working-tree' };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${flag}`);
    if (flag === '--dist-dir') result.distDir = value;
    else if (flag === '--output-dir') result.outputDir = value;
    else if (flag === '--source-revision') result.sourceRevision = value;
    else throw new Error(`未知参数：${flag}`);
  }
  if (!result.outputDir) throw new Error('必须通过 --output-dir 明确指定一个不存在的发布目录');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await packageRelease({ root, ...releaseArguments(process.argv.slice(2)) });
  console.log(JSON.stringify({ directory: result.directory, bytes: result.manifest.totalBytes, files: result.manifest.files.length, platform: result.manifest.platform, architecture: result.manifest.architecture }, null, 2));
}
