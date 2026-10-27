// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopLocations, isWithin, prepareDesktopLocations } from './locations.mjs';
import { mkdtemp, mkdir, writeFile, rm, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.join(os.tmpdir(), 'judu-location-test');
const standard = { packaged: false, appPath: path.join(root, 'app'), resourcesPath: path.join(root, 'install', 'resources'), userData: path.join(root, 'profile'),
  env: { JUDU_DESKTOP_RELEASE_DIR: path.join(root, 'core'), JUDU_DESKTOP_NODE_PATH: path.join(root, 'node.exe') } };
test('开发环境必须显式提供绝对的运行核心和Node路径', () => {
  assert.throws(() => desktopLocations({ ...standard, env: {} }), /绝对路径/);
  assert.throws(() => desktopLocations({ ...standard, env: { ...standard.env, JUDU_DESKTOP_DATA_DIR: 'data' } }), /绝对路径/);
});
test('打包成品忽略继承的开发目录，不误接入原项目data', () => {
  const result = desktopLocations({ ...standard, packaged: true, env: { ...standard.env, JUDU_DESKTOP_DATA_DIR: path.join(root, 'formal') } });
  assert.equal(result.releaseDir, path.join(root, 'install', 'resources', 'app-core'));
  assert.equal(result.nodePath, path.join(root, 'install', 'resources', 'node', 'node.exe'));
  assert.equal(result.dataDir, path.join(root, 'profile', 'library'));
});
test('数据不能写入应用资源，包括同目录与子目录；同名前缀不误判', () => {
  for (const target of [standard.appPath, path.join(standard.appPath, 'data'), path.join(standard.resourcesPath, 'data'), path.join(root, 'core', 'data')]) {
    assert.throws(() => desktopLocations({ ...standard, env: { ...standard.env, JUDU_DESKTOP_DATA_DIR: target } }), /之外/);
  }
  assert.equal(isWithin(path.join(root, 'app'), path.join(root, 'app-data')), false);
});
test('缺失资源失败；正常资源只初始化独立书库目录', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'judu-desktop-locations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const locations = { releaseDir: path.join(directory, 'core'), nodePath: path.join(directory, 'node.exe'), dataDir: path.join(directory, 'user', 'library') };
  await assert.rejects(prepareDesktopLocations(locations), /ENOENT/);
  await mkdir(locations.releaseDir); await writeFile(locations.nodePath, 'fixture');
  await writeFile(path.join(locations.releaseDir, 'start-release.mjs'), 'fixture');
  assert.deepEqual(await prepareDesktopLocations(locations), locations);
});

test('拒绝书库祖先junction，不能先向安装核心中创建目录', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'judu-desktop-junction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const core = path.join(directory, 'core'); await mkdir(core);
  const nodePath=path.join(directory,'node.exe');await writeFile(nodePath,'fixture');await writeFile(path.join(core,'start-release.mjs'),'fixture');
  const link=path.join(directory,'alias');await symlink(core,link,'junction');
  await assert.rejects(prepareDesktopLocations({releaseDir:core,nodePath,dataDir:path.join(link,'library')}),/链接/);
  await assert.rejects(access(path.join(core,'library')),/ENOENT/);
});
