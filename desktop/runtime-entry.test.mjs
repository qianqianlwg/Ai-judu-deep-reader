// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeReleaseDirectory } from './runtime-entry.mjs';
import path from 'node:path';
import os from 'node:os';
test('后台入口拒绝相对核心路径和缺失令牌，不默认启动正式书库', () => {
  assert.throws(()=>runtimeReleaseDirectory({}),/运行核心/);
  assert.throws(()=>runtimeReleaseDirectory({JUDU_DESKTOP_RELEASE_DIR:'relative'}),/运行核心/);
  assert.throws(()=>runtimeReleaseDirectory({JUDU_DESKTOP_RELEASE_DIR:os.tmpdir()}),/令牌/);
  const directory=path.join(os.tmpdir(),'core');
  assert.equal(runtimeReleaseDirectory({JUDU_DESKTOP_RELEASE_DIR:directory,JUDU_DESKTOP_TOKEN:'a'.repeat(64)}),directory);
});
