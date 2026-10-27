// @ts-check
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

/** @param {NodeJS.ProcessEnv} parent @param {{ port: number; dataDir: string; releaseDir: string; token: string }} options */
export function backendEnvironment(parent, options) {
  const env = { ...parent };
  // WHY：桌面进程继承的 Node 注入参数和 Electron 模式不能渗入独立后台及书籍解析子进程。
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']) delete env[key];
  return { ...env, NODE_ENV: 'production', PORT: String(options.port), HOSTNAME: '127.0.0.1',
    JUDU_APP_ORIGIN: `http://127.0.0.1:${options.port}`, JUDU_DATA_DIR: options.dataDir,
    JUDU_DESKTOP_RELEASE_DIR: options.releaseDir, JUDU_DESKTOP_TOKEN: options.token };
}
export async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配桌面后台端口');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
  return address.port;
}
/** @param {import('node:child_process').ChildProcess} child */
async function terminateOwnedTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', reject);
      killer.once('exit', code => {
        if (code !== 0 && child.exitCode === null && child.signalCode === null) reject(new Error('无法终止桌面后台进程树'));
        else resolve(undefined);
      });
    });
  } else if (!child.kill('SIGKILL')) throw new Error('无法终止桌面后台');
}
/**
 * @param {{ nodePath: string; releaseDir: string; dataDir: string; entryPath?: string;
 * signal?: AbortSignal; timeoutMs?: number; shutdownMs?: number;
 * onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
 * onLog?: (text: string) => void }} options
 */
export async function startDesktopServer(options) {
  options.signal?.throwIfAborted();
  const port = await unusedLoopbackPort();
  options.signal?.throwIfAborted();
  const origin = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString('hex');
  const child = spawn(options.nodePath, [options.entryPath ?? fileURLToPath(new URL('./runtime-entry.mjs', import.meta.url))], {
    cwd: options.releaseDir, windowsHide: true,
    env: backendEnvironment(process.env, { ...options, port, token }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  /** @type {Error | undefined} */ let processError;
  /** @type {Promise<void> | undefined} */ let stopping;
  let stopRequested = false;
  const closed = new Promise(resolve => child.once('exit', (code, signal) => {
    if (!stopRequested) options.onExit?.(code, signal);
    resolve(undefined);
  }));
  child.on('error', error => { processError = error; });
  // WHY：流必须被消费，防止后台日志填满管道后卡死；接收方负责限制落盘量且不得记录启动令牌。
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => options.onLog?.(String(chunk)));
  async function stop() {
    stopRequested = true;
    stopping ??= (async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      // WHY：Windows 先终止仍归属于自有父进程的整棵树，避免父进程先退出后遗留解析 worker。
      if (process.platform === 'win32') { await terminateOwnedTree(child); await closed; return; }
      if (child.connected) child.send({ type: 'shutdown' }, error => { if (error) processError = error; });
      const timeout = delay(options.shutdownMs ?? 3000).then(() => false);
      if (!await Promise.race([closed.then(() => true), timeout])) {
        await terminateOwnedTree(child);
        await Promise.race([closed, delay(3000).then(() => { throw new Error('后台进程终止后仍未退出'); })]);
      }
    })();
    return stopping;
  }
  try {
    const deadline = Date.now() + (options.timeoutMs ?? 60000);
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      if (processError) throw processError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`桌面后台提前退出（${child.exitCode ?? child.signalCode}）`);
      try {
        const response = await fetch(`${origin}/api/desktop/health`, {
          headers: { 'x-judu-desktop-token': token }, signal: AbortSignal.timeout(1000), redirect: 'error',
        });
        if (response.ok) {
          /** @type {unknown} */ const body = await response.json();
          if (!body || typeof body !== 'object' || !('pid' in body) || body.pid !== child.pid || !('protocol' in body) || body.protocol !== 1) {
            throw new Error('桌面后台身份校验失败');
          }
          options.signal?.throwIfAborted();
          if (child.exitCode !== null || child.signalCode !== null) throw new Error('桌面后台在就绪时退出');
          return { origin, port, pid: child.pid, stop };
        }
      } catch (error) {
        // WHY：只有尚未监听的连接失败可重试；身份或协议不符必须失败，不能连接其他进程。
        if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'TimeoutError')) throw error;
      }
      await delay(100, undefined, { signal: options.signal });
    }
    throw new Error('桌面后台启动超时，请检查运行核心完整性与本地权限');
  } catch (error) {
    try { await stop(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], '桌面启动失败，且后台清理未完成'); }
    throw error;
  }
}
