// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildUmdWorker } from './build-umd-worker.mjs';
test('UMD私有运行时可复现，源输入只有本项目解析模块', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'judu-umd-build-'));
  try {
    const a = await buildUmdWorker({ outDir: path.join(directory, 'a') }), b = await buildUmdWorker({ outDir: path.join(directory, 'b') });
    assert.deepEqual(a.manifest, b.manifest);
    for (const file of ['worker.cjs', 'manifest.json']) assert.deepEqual(await readFile(path.join(a.directory, file)), await readFile(path.join(b.directory, file)));
    assert.equal(a.manifest.inputs.length, 3);
    for (const input of a.manifest.inputs) { assert.equal(path.isAbsolute(input.path), false); assert.ok(input.path.startsWith('src/lib/umd-')); }
  } finally {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('judu-umd-build-')) throw new Error('测试目录清理越界');
    await rm(directory, { recursive: true, force: true });
  }
});
