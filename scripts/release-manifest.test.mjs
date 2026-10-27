import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { excludedReleasePath, fileSha256, inventoryRelease, requiredReleaseFiles, safeRelativePath, validateRequiredFiles, verifyRelease } from './release-manifest.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'judu-release-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('judu-release-test-')) throw new Error('测试目录不安全');
    await rm(resolved, { recursive: true, force: true });
  });
  return root;
}

test('发布路径拒绝逃逸、驱动器、反斜线和重复分隔符', () => {
  for (const value of ['', '../data', '/root', 'a/../b', 'C:/data', 'a\\b', 'a//b']) assert.throws(() => safeRelativePath(value));
  assert.equal(safeRelativePath('node_modules/next/package.json'), 'node_modules/next/package.json');
});

test('发布只排除应用源码与秘密，不删除依赖内部的运行源码', () => {
  for (const name of ['data/book.epub', 'src/app/page.tsx', '.env.production', 'node_modules/a/.env', '.next-release/cache/x']) assert.equal(excludedReleasePath(name), true, name);
  for (const name of ['node_modules/a/src/main.js', 'runtime/mobi/worker.cjs', '.next-release/server/app.js', 'public/fonts/lxgw-wenkai/OFL.txt']) assert.equal(excludedReleasePath(name), false, name);
});

test('文件清单按路径稳定排序、记录字节和哈希，拒绝混入数据', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'z'), '末尾'); await writeFile(path.join(root, 'a'), 'first');
  const result = await inventoryRelease(root);
  assert.deepEqual(result.map(file => file.path), ['a', 'z']);
  assert.equal(result[1].bytes, 6); assert.equal(result[0].sha256, await fileSha256(path.join(root, 'a')));
  await mkdir(path.join(root, 'data')); await writeFile(path.join(root, 'data', 'private'), 'secret');
  await assert.rejects(inventoryRelease(root), /禁止文件/);
});

test('所有必要 worker、许可、静态资源都必须存在', () => {
  const files = requiredReleaseFiles('.next-release').map(name => ({ path: name, bytes: 0, sha256: '0'.repeat(64) }));
  assert.throws(() => validateRequiredFiles(files, '.next-release'), /静态资源/);
  files.push({ path: '.next-release/static/test.js', bytes: 0, sha256: '0'.repeat(64) });
  validateRequiredFiles(files, '.next-release');
  assert.throws(() => validateRequiredFiles(files.filter(file => !file.path.endsWith('THIRD_PARTY_NOTICES.txt')), '.next-release'), /必要文件/);
});

test('清单验证拒绝路径逃逸、重复条目与缺失字段', async t => {
  const root = await fixture(t);
  const metadata = { schemaVersion: 1, distDir: '.next-release', sourceRevision: 'test', lockSha256: '0'.repeat(64), platform: process.platform, architecture: process.arch, nodeVersion: process.version, totalBytes: 0 };
  for (const files of [[{ path: '../data', bytes: 0, sha256: '0'.repeat(64) }], [{ path: 'same', bytes: 0, sha256: '0'.repeat(64) }, { path: 'same', bytes: 0, sha256: '0'.repeat(64) }], [{ path: 'x' }]]) {
    await writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({ ...metadata, files }));
    await assert.rejects(verifyRelease(root));
  }
  assert.ok((await readFile(path.join(root, 'release-manifest.json'), 'utf8')).length);
});

test('跨多个有界哈希批次仍逐个校验所有文件并保持路径排序', async t => {
  const root = await fixture(t);
  for (let i = 39; i >= 0; i--) await writeFile(path.join(root, `file-${String(i).padStart(2, '0')}`), String(i));
  const files = await inventoryRelease(root);
  assert.equal(files.length, 40);
  assert.deepEqual(files.map(file => file.path), [...files.map(file => file.path)].sort());
  for (const file of files) assert.equal(file.sha256, await fileSha256(path.join(root, file.path)));
});
