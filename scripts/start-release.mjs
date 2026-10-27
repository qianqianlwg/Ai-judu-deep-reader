// @ts-check
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyRelease } from './release-manifest.mjs';

/** @param {string} version */
export function supportedReleaseNode(version) {
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number);
  return major === 22 && (minor > 22 || minor === 22 && patch >= 2) || major === 24 && minor >= 15 || major >= 26;
}

/** @param {string} releaseDir @param {NodeJS.ProcessEnv} env */
export function validateReleaseEnvironment(releaseDir, env) {
  const dataDir = env.JUDU_DATA_DIR;
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('生产发布必须显式设置绝对路径 JUDU_DATA_DIR，不能隐式创建空书库');
  const relative = path.relative(path.resolve(releaseDir), path.resolve(dataDir));
  // WHY：业务数据不属于可替换的发布目录；升级或回滚只切换程序，不能切换、覆盖或删除用户书库。
  if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('JUDU_DATA_DIR 必须独立于发布目录');
  return { ...env, NODE_ENV: 'production', HOSTNAME: env.HOSTNAME || '127.0.0.1' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!supportedReleaseNode(process.version)) throw new Error('当前 jsdom 要求 Node ^22.22.2、^24.15.0 或 >=26，请使用兼容运行时');
  const root = path.dirname(fileURLToPath(import.meta.url));
  const manifest = await verifyRelease(root);
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) throw new Error('发布包平台/架构不匹配，不能跨平台复用原生依赖');
  Object.assign(process.env, validateReleaseEnvironment(root, process.env));
  await import(pathToFileURL(path.join(root, 'server.js')).href);
}
