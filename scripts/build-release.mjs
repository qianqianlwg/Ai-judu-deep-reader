// @ts-check
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildMobiWorker } from './build-mobi-worker.mjs';
import { buildUmdWorker } from './build-umd-worker.mjs';
import { packageRelease, releaseArguments } from './package-release.mjs';
import { supportedReleaseNode } from './start-release.mjs';
export { supportedReleaseNode } from './start-release.mjs';

/** @param {string} executable @param {string[]} args @param {{cwd: string, env: NodeJS.ProcessEnv}} options */
export async function runReleaseCommand(executable, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve(undefined) : reject(new Error(`发布命令失败：${args[0]}（${signal ?? code}）`)));
  });
}

/** @param {string} distDir @param {string} workspace @param {NodeJS.ProcessEnv} [parent] */
export function releaseBuildEnvironment(distDir, workspace, parent = process.env) {
  // WHY：构建只访问空的隔离书库和同盘临时目录，既不触碰正式数据，也不让 NFT 扫入构建机临时文件。
  return { ...parent, NEXT_DIST_DIR: distDir, JUDU_DATA_DIR: path.join(workspace, 'data'), TEMP: path.join(workspace, 'temp'), TMP: path.join(workspace, 'temp') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!supportedReleaseNode(process.version)) throw new Error('当前 jsdom 要求 Node ^22.22.2、^24.15.0 或 >=26；请使用兼容运行时，不要忽略引擎要求');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const options = releaseArguments(process.argv.slice(2));
  // WHY：生产包构建始终使用独立目录，不覆盖主项目 .next；Webpack 与已验证的服务器构建路径保持一致。
  if (options.distDir === '.next' || !/^\.next-[A-Za-z0-9_-]+$/.test(options.distDir)) throw new Error('发布构建目录必须使用独立的 .next-*，不得覆盖主项目');
  await buildMobiWorker();
  await buildUmdWorker();
  const workspace = await mkdtemp(path.join(root, '.verify-release-build-'));
  try {
    await mkdir(path.join(workspace, 'temp'));
    await runReleaseCommand(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
      cwd: root, env: releaseBuildEnvironment(options.distDir, workspace),
    });
    const result = await packageRelease({ root, ...options });
    console.log(JSON.stringify({ directory: result.directory, bytes: result.manifest.totalBytes, files: result.manifest.files.length }, null, 2));
  } finally {
    if (path.dirname(path.resolve(workspace)) !== root || !path.basename(workspace).startsWith('.verify-release-build-')) throw new Error('构建临时目录越界');
    await rm(workspace, { recursive: true, force: true });
  }
}
