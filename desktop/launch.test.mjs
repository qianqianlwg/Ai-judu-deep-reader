// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { electronEnvironment } from './launch.mjs';
test('启动桌面壳时清除Electron的Node模式和外部模块注入，不修改原环境',()=>{
  const original={PATH:'node',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require untrusted',NODE_PATH:'untrusted',JUDU_DESKTOP_DATA_DIR:'isolated'};
  assert.deepEqual(electronEnvironment(original),{PATH:'node',JUDU_DESKTOP_DATA_DIR:'isolated'});
  assert.equal(original.ELECTRON_RUN_AS_NODE,'1');
});
