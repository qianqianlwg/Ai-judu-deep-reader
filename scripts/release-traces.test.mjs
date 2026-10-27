import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectBundledDependencyNotices, collectDependencyNotices, collectReleaseTraces, collectRuntimePackages } from './release-traces.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'judu-traces-test-'));
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('judu-traces-test-')) throw new Error('测试目录越界');
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, '.next-test', 'server'), { recursive: true });
  return root;
}
async function trace(root, files) { await writeFile(path.join(root, '.next-test/server/route.js.nft.json'), JSON.stringify({ files })); }

test('追踪清单统一分隔符，过滤正式数据和系统临时文件，保留运行时闭包', async t => {
  const root = await fixture(t);
  await trace(root, ['../../runtime/mobi/worker.cjs', '..\\..\\runtime\\umd\\worker.cjs'.replaceAll('\\', path.sep), '../../data/private.epub', '../../.env.local', path.join(os.tmpdir(), 'host-private')]);
  const result = await collectReleaseTraces(root, '.next-test');
  assert.deepEqual(result.files, ['runtime/mobi/worker.cjs', 'runtime/umd/worker.cjs']);
  assert.equal(result.omittedHostFiles, 3);
});

test('Windows NFT 跨盘路径仅允许过滤真实系统临时目录，其他驱动器路径拒绝', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t);
  await trace(root, ['../../../../../' + os.tmpdir().replaceAll('\\', '/') + '/host-private']);
  assert.equal((await collectReleaseTraces(root, '.next-test')).omittedHostFiles, 1);
  await trace(root, ['../../../../../Z:/private/secret']);
  await assert.rejects(collectReleaseTraces(root, '.next-test'), /边界/);
});

test('缺少或损坏 NFT 清单不被视作完整发布', async t => {
  const root = await fixture(t);
  await assert.rejects(collectReleaseTraces(root, '.next-test'), /缺少/);
  await trace(root, [42]); await assert.rejects(collectReleaseTraces(root, '.next-test'), /格式/);
});

test('补齐已携带依赖及 Next 编译依赖的许可，不将整个依赖源码复制入包', async t => {
  const root = await fixture(t);
  for (const name of ['node_modules/a/LICENSE', 'node_modules/a/src/main.js', 'node_modules/next/dist/compiled/b/LICENSE.txt', 'node_modules/next/NOTICE']) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), name);
  }
  const files = await collectDependencyNotices(root, ['node_modules/a/src/main.js', 'node_modules/next/package.json']);
  assert.deepEqual(files, ['node_modules/a/LICENSE', 'node_modules/next/NOTICE', 'node_modules/next/dist/compiled/b/LICENSE.txt']);
  await symlink(path.join(root, 'node_modules/a'), path.join(root, 'node_modules/next/link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collectDependencyNotices(root, ['node_modules/next/package.json']), /链接/);
});

test('外部 worker 携带 hoist 与嵌套生产依赖，支持 exports 封闭元数据，缺依赖失败', async t => {
  const root = await fixture(t);
  const entries = {
    'node_modules/worker/package.json': { name: 'worker', dependencies: { child: '1', hoisted: '1', punycode: '1' }, optionalDependencies: { 'judu-not-installed-optional': '1' } },
    'node_modules/worker/node_modules/child/package.json': { name: 'child', exports: { import: './index.mjs' } },
    'node_modules/punycode/package.json': { name: 'punycode' },
    'node_modules/hoisted/package.json': { name: 'hoisted', dependencies: { worker: '1' } },
  };
  for (const [name, value] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), JSON.stringify(value));
  }
  assert.deepEqual(await collectRuntimePackages(root, ['worker']), ['node_modules/hoisted', 'node_modules/punycode', 'node_modules/worker', 'node_modules/worker/node_modules/child']);
  await assert.rejects(collectRuntimePackages(root, ['judu-not-installed-required']), /缺少/);
});

test('Webpack 已内嵌依赖也必须保留许可证，仅跳过未安装平台包与开发依赖', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/bundled': {}, 'node_modules/developer': { dev: true }, 'node_modules/uninstalled-platform': { optional: true } } }));
  for (const pkg of ['bundled', 'developer']) {
    await mkdir(path.join(root, 'node_modules', pkg), { recursive: true });
    await writeFile(path.join(root, 'node_modules', pkg, 'LICENSE'), 'license');
    await writeFile(path.join(root, 'node_modules', pkg, 'index.js'), 'not copied');
  }
  assert.deepEqual(await collectBundledDependencyNotices(root), ['node_modules/bundled/LICENSE']);
});
