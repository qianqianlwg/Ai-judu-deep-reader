// @ts-check
/** @param {string} target @param {string} origin */
export function allowsDesktopNavigation(target, origin) {
  try {
    const url = new URL(target);
    return url.protocol === 'http:' && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}
export const desktopWebPreferences = Object.freeze({
  // WHY：书籍与模型输出均不可信；桌面壳不能使网页获得 Node、文件系统或任意 IPC 权限。
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
});
/** @param {import('electron').WebContents} contents @param {() => string | undefined} origin */
export function protectDesktopContents(contents, origin) {
  const guard = (/** @type {{ preventDefault(): void }} */ event, /** @type {string} */ url) => {
    if (!origin() || !allowsDesktopNavigation(url, origin() ?? '')) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
}
