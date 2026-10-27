// @ts-check
import path from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';

/** @param {string} root @param {string} candidate */
export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
/** @param {{ packaged: boolean; resourcesPath: string; appPath: string; userData: string; dataDir?: string; env?: NodeJS.ProcessEnv }} options */
export function desktopLocations(options) {
  const env = options.env ?? {};
  const releaseDir = options.packaged ? path.join(options.resourcesPath, 'app-core') : env.JUDU_DESKTOP_RELEASE_DIR;
  const nodePath = options.packaged ? path.join(options.resourcesPath, 'node', 'node.exe') : env.JUDU_DESKTOP_NODE_PATH;
  const dataDir = options.dataDir || !options.packaged && env.JUDU_DESKTOP_DATA_DIR || path.join(options.userData, 'library');
  if (!releaseDir || !nodePath || ![releaseDir, nodePath, dataDir].every(path.isAbsolute)) {
    throw new Error('桌面运行核心、Node 和数据目录必须是显式的绝对路径');
  }
  const resolved = { releaseDir: path.resolve(releaseDir), nodePath: path.resolve(nodePath), dataDir: path.resolve(dataDir) };
  // WHY：用户书库不属于安装资源，升级/卸载程序不能覆盖它；正式成品也不信任继承的开发环境路径。
  for (const root of [options.appPath, options.resourcesPath, releaseDir, ...(options.packaged ? [path.dirname(options.resourcesPath)] : [])]) {
    if (isWithin(path.resolve(root), resolved.dataDir)) throw new Error('书库必须保存在安装目录与运行核心之外');
  }
  return resolved;
}
/** @param {ReturnType<typeof desktopLocations>} locations */
export async function prepareDesktopLocations(locations) {
  for (const file of [locations.nodePath, path.join(locations.releaseDir, 'start-release.mjs')]) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('桌面运行资源缺失或不是普通文件');
  }
  await validateDataDirectory(locations.dataDir);
  await mkdir(locations.dataDir, { recursive: true });
  const realData = await realpath(locations.dataDir);
  const realRelease = await realpath(locations.releaseDir);
  if (isWithin(realRelease, realData)) throw new Error('书库真实路径不能位于运行核心中');
  if ((await lstat(locations.dataDir)).isSymbolicLink()) throw new Error('书库根目录不能是链接');
  return locations;
}

/** @param {string} directory */
export async function validateDataDirectory(directory){
  // WHY：父目录也检查真实路径，不能让已有 junction 把可写书库指向安装资源。
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('书库目录链不能包含链接或普通文件');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
      throw error;
    }
  }
}
