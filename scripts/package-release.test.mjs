import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyReleaseTree, packageRelease, releaseArguments, rejectLinkedAncestors, validateOutputDirectory } from './package-release.mjs';
import { requiredReleaseFiles, verifyRelease } from './release-manifest.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'judu-package-test-'));
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('judu-package-test-')) throw new Error('测试目录不安全');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function put(root, name, content = name) { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }

test('发布目录不能覆盖源码、祖先、正式数据或当前构建', () => {
  const root = path.resolve('release-source');
  for (const destination of [root, path.dirname(root), path.join(root, 'data', 'release'), path.join(root, '.next')]) assert.throws(() => validateOutputDirectory(root, destination));
  assert.equal(validateOutputDirectory(root, path.join(root, 'build', 'release')), path.join(root, 'build', 'release'));
});

test('复制器过滤秘密与用户数据，相同字节可合并而异内容不能覆盖', async t => {
  const root = await fixture(t), source = path.join(root, 'source'), target = path.join(root, 'target');
  await put(source, '.env.local', 'secret'); await put(source, 'data/book', 'user'); await put(source, 'node_modules/pkg/src/index.js', 'runtime');
  await copyReleaseTree(source, target); await copyReleaseTree(source, target);
  assert.equal(await readFile(path.join(target, 'node_modules/pkg/src/index.js'), 'utf8'), 'runtime');
  await assert.rejects(readFile(path.join(target, '.env.local')), /ENOENT/);
  await put(source, 'node_modules/pkg/src/index.js', 'changed'); await assert.rejects(copyReleaseTree(source, target), /EEXIST/);
});

test('组装真实目录、保留完整静态资源并验证篡改；拒绝覆盖已发布版本', async t => {
  const root = await fixture(t), dist = '.next-release', standalone = path.join(root, dist, 'standalone');
  for (const name of requiredReleaseFiles(dist)) {
    await put(standalone, name);
    if (name.startsWith('runtime/') || name.startsWith('scripts/epub/')) await put(root, name);
  }
  for (const pkg of ['jsdom', 'jszip']) await put(root, `node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg }));
  await put(root, `${dist}/server/test.js.nft.json`, JSON.stringify({ files: ['../../runtime/mobi/worker.cjs'] }));
  await rm(path.join(standalone, 'runtime'), { recursive: true });
  for (const name of ['start-release.mjs', 'release-manifest.mjs']) await put(root, 'scripts/' + name, name);
  await put(standalone, '.env.production', 'NEVER_COPY_SECRET');
  await put(root, 'public/vendor/foliate/epub.js');
  await put(root, 'public/extra.css', 'style'); await put(root, `${dist}/static/test.js`, 'js'); await put(root, 'package-lock.json', '{"packages":{}}');
  const outputDir = path.join(root, 'build', 'version-one');
  const result = await packageRelease({ root, outputDir, distDir: dist, sourceRevision: 'test-revision' });
  assert.equal(result.manifest.sourceRevision, 'test-revision'); assert.ok(result.manifest.totalBytes > 0);
  assert.ok(!result.manifest.files.some(file => file.path.includes('.env')));
  await verifyRelease(outputDir);
  await assert.rejects(packageRelease({ root, outputDir, distDir: dist, sourceRevision: 'other' }), /EEXIST/);
  await put(outputDir, 'public/extra.css', 'tampered'); await assert.rejects(verifyRelease(outputDir), /校验失败/);
});

test('发布 CLI 不接受隐式目标、未知参数或缺值', () => {
  assert.throws(() => releaseArguments([]), /output-dir/);
  assert.throws(() => releaseArguments(['--output-dir']), /缺少值/);
  assert.throws(() => releaseArguments(['--unknown', 'x']), /未知参数/);
  assert.deepEqual(releaseArguments(['--output-dir', 'build/release', '--source-revision', 'abc']), { outputDir: 'build/release', distDir: '.next-release', sourceRevision: 'abc' });
});

test('即便发布路径词法合法，也拒绝经 junction 祖先写入正式数据目录', async t => {
  const root = await fixture(t), data = path.join(root, 'data');
  await mkdir(data);
  await symlink(data, path.join(root, 'build'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.doesNotThrow(() => validateOutputDirectory(root, path.join(root, 'build', 'version')));
  await assert.rejects(rejectLinkedAncestors(path.join(root, 'build')), /符号链接祖先/);
  await assert.rejects(packageRelease({ root, outputDir: path.join(root, 'build', 'version'), sourceRevision: 'test' }), /符号链接祖先/);
  await assert.rejects(readFile(path.join(data, 'version', '.incomplete')), /ENOENT/);
});
