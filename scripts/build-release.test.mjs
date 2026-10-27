import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportedReleaseNode, runReleaseCommand, releaseBuildEnvironment } from './build-release.mjs';

test('发布构建要求实际生产依赖支持的 Node，而不是忽略 engine 告警', () => {
  for (const version of ['22.22.2', 'v22.23.0', '24.15.0', '24.22.1', '26.0.0']) assert.equal(supportedReleaseNode(version), true, version);
  for (const version of ['20.19.0', '22.22.0', '22.22.1', '23.0.0', '24.14.9', '25.0.0', 'invalid']) assert.equal(supportedReleaseNode(version), false, version);
});
test('构建命令的非零退出与启动失败必须上抛', async () => {
  await runReleaseCommand(process.execPath, ['-e', 'process.exit(0)'], { cwd: process.cwd(), env: process.env });
  await assert.rejects(runReleaseCommand(process.execPath, ['-e', 'process.exit(7)'], { cwd: process.cwd(), env: process.env }), /失败/);
  await assert.rejects(runReleaseCommand('judu-command-does-not-exist', [], { cwd: process.cwd(), env: process.env }), /ENOENT/);
});

test('构建不继承正式书库，临时文件固定在同盘隔离工作目录', () => {
  const parent = { JUDU_DATA_DIR: 'formal-data', TEMP: 'host-temp', TMP: 'host-temp', PATH: 'node' };
  const workspace = path.resolve('.verify-release-build-test');
  const env = releaseBuildEnvironment('.next-release', workspace, parent);
  assert.equal(env.JUDU_DATA_DIR, path.join(workspace, 'data'));
  assert.equal(env.TEMP, path.join(workspace, 'temp')); assert.equal(env.TMP, env.TEMP);
  assert.equal(env.NEXT_DIST_DIR, '.next-release'); assert.equal(parent.JUDU_DATA_DIR, 'formal-data');
});

test('实际 Webpack 编译后 EPUB worker 仍拿到原生 jsdom 路径而非数字或虚拟命名空间', async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const directory = await mkdtemp(path.join(root, '.verify-release-loader-test-'));
  t.after(async () => {
    if (path.dirname(path.resolve(directory)) !== root || !path.basename(directory).startsWith('.verify-release-loader-test-')) throw new Error('测试目录越界');
    await rm(directory, { recursive: true, force: true });
  });
  const source = await readFile(path.join(root, 'src/lib/foliate-import.ts'), 'utf8');
  const transformed = await transform(source, { loader: 'ts', format: 'esm', target: 'node24' });
  const input = path.join(directory, 'entry.mjs'); await writeFile(input, transformed.code);
  const require = createRequire(import.meta.url);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  // WHY：此回归只检查生产模式的原生模块解析变换；完整 Next 构建另由仓库外 HTTP 冒烟验证，不依赖内部压缩插件。
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'production', target: 'node', entry: input, optimization: { minimize: false },
      output: { path: directory, filename: 'compiled.cjs', library: { type: 'commonjs2' } } });
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError || stats?.hasErrors()) reject(error ?? closeError ?? new Error(stats?.toString({ all: false, errors: true })));
      else resolve(undefined);
    }));
  });
  const compiled = require(path.join(directory, 'compiled.cjs'));
  const entry = compiled.resolveFoliateJsdomEntry();
  assert.equal(path.isAbsolute(entry), true);
  assert.equal(entry, require.resolve('jsdom'));
});
