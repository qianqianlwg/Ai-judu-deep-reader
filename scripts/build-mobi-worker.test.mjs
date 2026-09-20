// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMobiWorker } from './build-mobi-worker.mjs';

test('MOBI私有运行时可复现，携带实际打包依赖许可且不带机器路径', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'judu-mobi-build-'));
  try {
    const first = await buildMobiWorker({ outDir: path.join(directory, 'one') });
    const second = await buildMobiWorker({ outDir: path.join(directory, 'two') });
    assert.deepEqual(first.manifest, second.manifest);
    for (const name of ['worker.cjs', 'manifest.json', 'THIRD_PARTY_NOTICES.txt']) {
      assert.deepEqual(await readFile(path.join(first.directory, name)), await readFile(path.join(second.directory, name)));
    }
    const names = first.manifest.packages.map(item => item.name);
    for (const name of ['@lingo-reader/mobi-parser', '@lingo-reader/shared', 'fflate', 'parse5', 'entities', 'css-tree']) assert.ok(names.includes(name));
    for (const input of first.manifest.inputs) assert.equal(path.isAbsolute(input.path), false);
    assert.equal(first.manifest.entry, 'worker.cjs');
    assert.ok(first.manifest.inputs.some(input=>input.path==='public/vendor/foliate/vendor/csstree.esm.js'));
    assert.match(await readFile(path.join(first.directory,'THIRD_PARTY_NOTICES.txt'),'utf8'), /Roman Dvornov/);
    assert.match(first.manifest.sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.manifest.inputs.some(input => input.path === 'vendor/mobi/index.mjs'), true);
    assert.equal(first.manifest.inputs.some(input => input.path.includes('@lingo-reader/mobi-parser/')), false);
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('judu-mobi-build-')) throw new Error('测试清理越界');
    await rm(resolved, { recursive: true, force: true });
  }
});
