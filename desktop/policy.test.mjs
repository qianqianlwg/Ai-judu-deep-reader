// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsDesktopNavigation, desktopWebPreferences, protectDesktopContents } from './policy.mjs';
test('只允许当前本地核心，拒绝其他端口、域名、脚本与文件导航', () => {
  const origin='http://127.0.0.1:3319';
  assert.equal(allowsDesktopNavigation(origin+'/reader?id=1#p', origin), true);
  for(const url of ['https://example.com','http://127.0.0.1:3000','http://localhost:3319','file:///C:/private','javascript:alert(1)','data:text/html,test','http://user:pass@127.0.0.1:3319','invalid']) {
    assert.equal(allowsDesktopNavigation(url, origin), false, url);
  }
  assert.deepEqual(desktopWebPreferences, {nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false});
});
test('窗口拒绝弹窗、webview和网页权限，无就绪origin时拒绝跳转', () => {
  const handlers=new Map(); let permission; let check; let popup;
  const fake={ on:(name,callback)=>handlers.set(name,callback),setWindowOpenHandler:handler=>{popup=handler;},session:{setPermissionRequestHandler:handler=>{permission=handler;},setPermissionCheckHandler:handler=>{check=handler;}} };
  protectDesktopContents(/** @type {import('electron').WebContents} */ (/** @type {unknown} */ (fake)),()=>undefined);
  let prevented=0; handlers.get('will-navigate')({preventDefault:()=>prevented++},'http://127.0.0.1:3319');
  handlers.get('will-attach-webview')({preventDefault:()=>prevented++});
  assert.equal(prevented,2); assert.deepEqual(popup(),{action:'deny'}); assert.equal(check(),false);
  permission(null,'camera',allowed=>assert.equal(allowed,false));
});
