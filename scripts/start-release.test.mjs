import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { supportedReleaseNode, validateReleaseEnvironment } from './start-release.mjs';

test('生产启动拒绝缺少数据路径、相对路径和发布目录内部的数据', () => {
  const root = path.resolve('release-root');
  for (const value of [undefined, 'data', root, path.join(root, 'data')]) assert.throws(() => validateReleaseEnvironment(root, { JUDU_DATA_DIR: value }), /JUDU_DATA_DIR/);
});
test('生产启动保持显式外部数据路径，默认仅监听回环', () => {
  const root = path.resolve('release-root'), data = path.resolve('formal-data');
  const env = validateReleaseEnvironment(root, { JUDU_DATA_DIR: data, PORT: '3000' });
  assert.equal(env.JUDU_DATA_DIR, data); assert.equal(env.HOSTNAME, '127.0.0.1'); assert.equal(env.PORT, '3000');
  assert.equal(validateReleaseEnvironment(root, { JUDU_DATA_DIR: data, HOSTNAME: '0.0.0.0' }).HOSTNAME, '0.0.0.0');
});
test('启动前执行与构建相同的 Node 兼容性门槛', () => {
  assert.equal(supportedReleaseNode('24.22.1'), true); assert.equal(supportedReleaseNode('22.22.0'), false);
});
