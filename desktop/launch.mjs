// @ts-check
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** @param {NodeJS.ProcessEnv} parent */
export function electronEnvironment(parent) {
  const env = { ...parent };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key];
  return env;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const {buildDesktopGuard}=await import('../scripts/build-desktop-guard.mjs');
  await buildDesktopGuard(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  const require = createRequire(import.meta.url);
  /** @type {string} */ const executable = require('electron');
  const child = spawn(executable, [path.dirname(fileURLToPath(import.meta.url)), ...process.argv.slice(2)], {
    env: electronEnvironment(process.env), stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => { console.error('无法启动桌面窗口', error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
