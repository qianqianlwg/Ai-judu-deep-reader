// @ts-check
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { desktopLocations, prepareDesktopLocations } from './locations.mjs';
import { desktopWebPreferences, protectDesktopContents } from './policy.mjs';
import { startDesktopServer } from './server.mjs';
import { unlockLibraryKey } from './vault.mjs';
import { runLibraryOperation } from './library-process.mjs';
import { atomicJson, readLibraryChoice, readDesktopPort, lockLibrary } from './preferences.mjs';
import { chooseNewLibrary } from './library-dialog.mjs';
import {confirmDesktopExit}from'./exit-policy.mjs';
import { logDesktopEvent } from './log.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// WHY：显式profile参数支持多个隔离阅读空间；打包后仍不接受继承的开发路径环境变量。
const explicitProfile=process.argv.find(value=>value.startsWith('--profile-dir='))?.slice('--profile-dir='.length);
const profile=explicitProfile||(!app.isPackaged&&process.env.JUDU_DESKTOP_PROFILE_DIR);
if(profile){if(!path.isAbsolute(profile))throw new Error('profile必须是绝对路径');app.setPath('userData',profile);}
const startup = new AbortController();
/** @type {BrowserWindow | undefined} */ let window;
/** @type {Promise<Awaited<ReturnType<typeof startDesktopServer>>> | undefined} */ let serverStart;
/** @type {string | undefined} */ let origin;
/** @type {(()=>Promise<void>)|undefined} */ let releaseLock;
let quitting=false,closing=false,waiting=false,switching=false;
let logging=Promise.resolve();
/** @param {string} event @param {Parameters<typeof logDesktopEvent>[2]} [details] */
function log(event,details){logging=logging.then(()=>logDesktopEvent(app.getPath('userData'),event,details));logging.catch(error=>console.error('诊断日志写入失败',error));}
function locationOptions(){return {packaged:app.isPackaged,appPath:app.getAppPath(),resourcesPath:process.resourcesPath,userData:app.getPath('userData'),env:process.env};}
async function requestQuit(){
 if(closing||switching)return;closing=true;
 try{
  const server=await serverStart;
  const confirmed=await confirmDesktopExit({
   busy:async()=>{if(!server)return 0;try{return Number(await server.busy());}catch(error){console.error('退出任务检查失败',error);return -1;}},
   choose:async count=>{
    const choice=await dialog.showMessageBox({type:'warning',title:'后台任务尚未完成',message:count<0?'无法确认后台状态':'仍有导入、解读或索引任务',detail:'强制退出可能中断结果；下次启动会标记中断，不会自动重新调用模型。',buttons:['等待任务完成再退出','取消退出','强制退出'],cancelId:1,defaultId:1});
    return choice.response===0?'wait':choice.response===2?'force':'cancel';
   },
   waiting:()=>waiting,pause:()=>delay(500),onWaiting:value=>{waiting=value;window?.setTitle(value?'句读阅读器 — 等待任务完成（菜单可取消）':'句读阅读器');}
  });
  if(!confirmed)return;
  quitting=true;startup.abort();await server?.stop();await releaseLock?.();releaseLock=undefined;
  log('stopped');await logging;app.quit();
 }catch(error){quitting=false;console.error('退出失败',error);dialog.showErrorBox('退出未完成','后台清理未完成，请保留当前窗口并重试。');}
 finally{closing=false;}
}
async function switchLibrary(existing=false){
 if(switching||closing)return;switching=true;
 try{
  const server=await serverStart;if(server&&Number(await server.busy())!==0)throw new Error('请先等待当前后台任务完成，再切换书库');
  const base=desktopLocations(locationOptions());let directory;
  if(existing){const result=await dialog.showOpenDialog({title:'选择已有客户端书库（包含 desktop-library.json 和凭据文件）',properties:['openDirectory']});directory=result.filePaths[0];if(directory)await lstat(path.join(directory,'desktop-library.json'));}
  else directory=await chooseNewLibrary({nodePath:base.nodePath,profile:app.getPath('userData'),encrypt:value=>safeStorage.encryptStringAsync(value),validate:directory=>{desktopLocations({...locationOptions(),dataDir:directory});}});
  if(!directory)return;
  const locations=desktopLocations({...locationOptions(),dataDir:directory});await prepareDesktopLocations(locations);
  const unlock=await lockLibrary(directory);
  try{const key=await unlockLibraryKey(directory,safeStorage);await runLibraryOperation(base.nodePath,{operation:'prepare',directory},key);}
  finally{await unlock();}
  await atomicJson(path.join(app.getPath('userData'),'library-choice.json'),{directory});
  // WHY：选择验证成功后才保存；重启时服务重新装配，不在业务模块偷偷切换数据库连接。
  await server?.stop();await releaseLock?.();releaseLock=undefined;quitting=true;
  app.relaunch();app.quit();
 }catch(error){console.error('书库切换失败',error);dialog.showErrorBox('书库未切换',error instanceof Error?error.message:'未知错误；原书库保持不变');}
 finally{switching=false;}
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window?.isMinimized())window.restore();window?.focus();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();void requestQuit();});
 void app.whenReady().then(async()=>{
  await mkdir(app.getPath('userData'),{recursive:true});
  const base=desktopLocations(locationOptions());
  let directory=await readLibraryChoice(app.getPath('userData'));
  if(!directory&&(app.isPackaged||!process.env.JUDU_DESKTOP_DATA_DIR)){
   directory=await chooseNewLibrary({nodePath:base.nodePath,profile:app.getPath('userData'),encrypt:value=>safeStorage.encryptStringAsync(value),validate:directory=>{desktopLocations({...locationOptions(),dataDir:directory});}});
   if(!directory){quitting=true;app.quit();return;}
  }
  const locations=desktopLocations({...locationOptions(),...(directory?{dataDir:directory}:{})});
  await prepareDesktopLocations(locations);releaseLock=await lockLibrary(locations.dataDir);
  const key=await unlockLibraryKey(locations.dataDir,safeStorage);
  const recovery=await runLibraryOperation(locations.nodePath,{operation:'prepare',directory:locations.dataDir},key);
  await atomicJson(path.join(app.getPath('userData'),'library-choice.json'),{directory:locations.dataDir});
  log('prepared');
  startup.signal.throwIfAborted();
  window=new BrowserWindow({width:1320,height:900,minWidth:900,minHeight:640,title:'句读阅读器',backgroundColor:'#faf8f3',webPreferences:desktopWebPreferences});
  window.on('close',event=>{if(!quitting){event.preventDefault();void requestQuit();}});
  protectDesktopContents(window.webContents,()=>origin);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'书库',submenu:[{label:'新建 / 复制旧Web书库',click:()=>void switchLibrary()},{label:'切换客户端书库',click:()=>void switchLibrary(true)},{label:'打开当前书库目录',click:()=>void shell.openPath(locations.dataDir).then(error=>{if(error)dialog.showErrorBox('无法打开书库目录',error);})},{type:'separator'},{label:'取消等待退出',click:()=>{waiting=false;window?.setTitle('句读阅读器');}},{label:'退出',click:()=>app.quit()}]},
   {label:'窗口',submenu:[{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'},{role:'togglefullscreen'}]},
   {label:'帮助',submenu:[{label:'诊断日志位置',click:()=>void shell.openPath(app.getPath('userData')).then(error=>{if(error)dialog.showErrorBox('无法打开日志目录',error);})},{label:'关于内测版',click:()=>void dialog.showMessageBox({message:'句读阅读器 Windows 内测版',detail:'未签名版本。书库与安装目录分离；卸载不删除书库。备份时请关闭客户端并完整复制当前书库（包含凭据文件），密钥仅原Windows账户可解锁。'})}]}
  ]));
  await window.loadFile(path.join(root,'startup.html'));
  serverStart=startDesktopServer({...locations,port:await readDesktopPort(app.getPath('userData')),secretKey:key,signal:startup.signal,onLog:text=>process.stdout.write(text),onExit:(code,signal)=>{
   if(quitting)return;log('backend-exit',{code});dialog.showErrorBox('句读后台已停止',`后台意外退出（${code??signal}），书库保留，请重新打开。`);void requestQuit();
  }});
  const server=await serverStart;origin=server.origin;await atomicJson(path.join(app.getPath('userData'),'desktop-port.json'),{port:server.port});log('started',{port:server.port,pid:server.pid});
  if(!startup.signal.aborted&&!window.isDestroyed())await window.loadURL(origin);
  if(recovery&&typeof recovery==='object'&&'recovered'in recovery&&Number(recovery.recovered)>0)void dialog.showMessageBox({type:'info',message:'已标记上次中断的任务',detail:'原文与已保存内容保留。中断的解读/索引不会自动重试，请在界面明确重试。'});
 }).catch(async error=>{
  console.error('桌面启动失败',error);log('startup-failed');
  dialog.showErrorBox('句读无法启动',error instanceof Error?error.message:'未知启动错误');
  try{await(await serverStart)?.stop();await releaseLock?.();}catch(cleanup){console.error('启动清理失败',cleanup);}
  quitting=true;app.quit();
 });
}
