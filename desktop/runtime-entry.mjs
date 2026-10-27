// @ts-check
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** @param {NodeJS.ProcessEnv} env */
export function runtimeReleaseDirectory(env) {
  if (!env.JUDU_DESKTOP_RELEASE_DIR || !path.isAbsolute(env.JUDU_DESKTOP_RELEASE_DIR)) throw new Error('缺少桌面运行核心目录');
  if (!env.JUDU_DESKTOP_TOKEN || env.JUDU_DESKTOP_TOKEN.length < 32) throw new Error('缺少桌面启动校验令牌');
  return env.JUDU_DESKTOP_RELEASE_DIR;
}
export function shutdownRuntime() {
  // WHY：复用 Next 的退出处理以关闭服务；父进程还会在超时后终止其拥有的进程树。
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
  else process.exit(0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = runtimeReleaseDirectory(process.env);
  process.on('message', message => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown') shutdownRuntime();
  });
  process.on('disconnect', shutdownRuntime);
  // WHY：工作目录就是成品目录，EPUB/MOBI/UMD 的 process.execPath 仍是随包 Node，而非 Electron。
  process.chdir(root);
  const { supportedReleaseNode, validateReleaseEnvironment } = await import(pathToFileURL(path.join(root, 'start-release.mjs')).href);
  const { verifyRelease } = await import(pathToFileURL(path.join(root, 'release-manifest.mjs')).href);
  if (!supportedReleaseNode(process.version)) throw new Error('桌面后台 Node 版本不兼容');
  const manifest = await verifyRelease(root);
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) throw new Error('桌面后台平台或架构不匹配');
  Object.assign(process.env, validateReleaseEnvironment(root, process.env));
  await import(pathToFileURL(path.join(root, 'server.js')).href);
}
