// @ts-check
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopLocations, prepareDesktopLocations } from './locations.mjs';
import { desktopWebPreferences, protectDesktopContents } from './policy.mjs';
import { startDesktopServer } from './server.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// WHY：开发验证使用独立 profile；已打包成品忽略路径环境变量，避免误接入开发/正式书库。
if (!app.isPackaged && process.env.JUDU_DESKTOP_PROFILE_DIR) {
  if (!path.isAbsolute(process.env.JUDU_DESKTOP_PROFILE_DIR)) throw new Error('桌面验证 profile 必须是绝对路径');
  app.setPath('userData', process.env.JUDU_DESKTOP_PROFILE_DIR);
}
const startup = new AbortController();
/** @type {BrowserWindow | undefined} */ let window;
/** @type {Promise<Awaited<ReturnType<typeof startDesktopServer>>> | undefined} */ let serverStart;
/** @type {string | undefined} */ let origin;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; startup.abort();
    void (async () => {
      try {
        const server = await serverStart?.catch(error => {
          // WHY：退出阶段也保留启动失败证据，不能因正在关窗而静默丢失异常。
          console.warn('关闭期间后台启动未完成', error); return undefined;
        });
        await server?.stop();
      }
      catch (error) { console.error('桌面后台退出清理失败', error); app.exit(1); return; }
      app.quit();
    })();
  });
  void app.whenReady().then(async () => {
    const locations = desktopLocations({ packaged: app.isPackaged, appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath, userData: app.getPath('userData'), env: process.env });
    await prepareDesktopLocations(locations);
    startup.signal.throwIfAborted();
    window = new BrowserWindow({ width: 1320, height: 900, minWidth: 900, minHeight: 640,
      title: '句读阅读器', backgroundColor: '#faf8f3', autoHideMenuBar: true,
      webPreferences: desktopWebPreferences });
    protectDesktopContents(window.webContents, () => origin);
    await window.loadFile(path.join(root, 'startup.html'));
    serverStart = startDesktopServer({ ...locations, signal: startup.signal,
      onLog: text => process.stdout.write(text),
      onExit: (code, signal) => {
        if (!origin || quitting) return;
        dialog.showErrorBox('句读后台已停止', `后台意外退出（${code ?? signal}）。书库保留在本地，请重新打开客户端。`);
        app.quit();
      } });
    const server = await serverStart;
    origin = server.origin;
    if (!startup.signal.aborted && !window.isDestroyed()) await window.loadURL(origin);
  }).catch(error => {
    if (quitting && error instanceof Error && error.name === 'AbortError') console.info('窗口关闭，桌面启动已取消');
    else console.error('桌面启动失败', error);
    if (!quitting) { dialog.showErrorBox('句读无法启动', error instanceof Error ? error.message : '未知启动错误'); app.quit(); }
  });
}
