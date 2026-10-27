import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import JSZip from 'jszip';
import { availableSmokePort, smokeArguments, smokeEnvironment, smokeFixtures } from './smoke-release.mjs';

test('验证环境不继承真实模型密钥、正式 data 或源码依赖搜索路径', () => {
  const env = smokeEnvironment(3317, '/isolated/data', { PATH: '/node', NODE_PATH: '/original/node_modules', NODE_OPTIONS: '--require /original/hook.js', OPENAI_API_KEY: 'test-secret', JUDU_DATA_DIR: '/production/data' });
  assert.equal(env.PATH, '/node'); assert.equal(env.JUDU_DATA_DIR, '/isolated/data');
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_PATH, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.JUDU_APP_ORIGIN, 'http://127.0.0.1:3317');
});
test('拒绝主端口与已占用端口，自动端口查找后确实释放', async () => {
  await assert.rejects(availableSmokePort(3000)); await assert.rejects(availableSmokePort(NaN));
  const port = await availableSmokePort(0); const server = net.createServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try { await assert.rejects(availableSmokePort(port), /EADDRINUSE/); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  assert.equal(await availableSmokePort(port), port);
});
test('测试资料自造或来自仓库许可夹具，不使用正式书库', async () => {
  const files = await smokeFixtures(); assert.equal(files.length, 8);
  assert.equal(files.find(file => file.name.endsWith('.pdf')).bytes.subarray(0, 5).toString(), '%PDF-');
  const epub = await JSZip.loadAsync(files.find(file => file.name.endsWith('.epub')).bytes);
  assert.ok(epub.file('META-INF/container.xml'));
  const cbz = await JSZip.loadAsync(files.find(file => file.name.endsWith('.cbz')).bytes);
  assert.ok(cbz.file('001.png'));
});
test('冒烟 CLI 必须明确发布目录并拒绝未知参数', () => {
  assert.throws(() => smokeArguments([]), /release-dir/);
  assert.throws(() => smokeArguments(['--secret', 'x']), /未知参数/);
  assert.deepEqual(smokeArguments(['--release-dir', 'build/release', '--port', '3318']), { releaseDir: 'build/release', port: 3318, report: '' });
});
