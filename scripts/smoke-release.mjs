// @ts-check
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import sharp from 'sharp';
import { makeEpub, makePdf } from '../src/app/api/import/fixtures.ts';
import { makeMobiFixture } from '../src/lib/mobi-fixture.ts';
import { makeUmdFixture } from '../src/lib/umd-fixture.ts';
import { verifyRelease } from './release-manifest.mjs';

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) { assert.ok(value && typeof value === 'object' && !Array.isArray(value), '响应不是对象'); return /** @type {Record<string, unknown>} */ (value); }
/** @param {string | Uint8Array} value */
const hash = value => createHash('sha256').update(value).digest('hex');

/** @param {number} port */
export async function availableSmokePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || port === 3000) throw new Error('验证端口必须有效且不能使用主端口 3000');
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(undefined)); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
  return address.port;
}

/** @param {number} port @param {string} dataDir @param {NodeJS.ProcessEnv} [parent] */
export function smokeEnvironment(port, dataDir, parent = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  // WHY：不继承 NODE_PATH、预加载脚本或模型密钥；发布进程不能偷偷借用原仓库依赖或正式配置。
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LANG']) if (parent[key]) env[key] = parent[key];
  return { ...env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', JUDU_APP_ORIGIN: `http://127.0.0.1:${port}`, JUDU_DATA_DIR: dataDir };
}

export async function smokeFixtures() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fb2 = await readFile(path.join(root, 'src/lib/fixtures/reader.fb2'));
  const fbz = new JSZip(); fbz.file('reader.fb2', fb2);
  const cbz = new JSZip(); cbz.file('001.png', await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer());
  return [
    { name: 'release.txt', bytes: Buffer.from('发布包独立运行验证。\n\n来源和标注必须逐字保留。') },
    { name: 'release.md', bytes: Buffer.from('# 发布验收\n\nMarkdown 来源。') },
    { name: 'release.epub', bytes: makeEpub(false, false, true) },
    { name: 'release.pdf', bytes: makePdf() },
    { name: 'release.mobi', bytes: makeMobiFixture() },
    { name: 'release.fb2', bytes: fb2 },
    { name: 'release.fbz', bytes: await fbz.generateAsync({ type: 'nodebuffer' }) },
    { name: 'release.cbz', bytes: await cbz.generateAsync({ type: 'nodebuffer' }) },
  ];
}

/** @param {string} directory @param {NodeJS.ProcessEnv} env */
async function verifyUmdCandidate(directory, env) {
  await new Promise((resolve, reject) => {
    const child = fork(path.join(directory, 'runtime/umd/worker.cjs'), [], { cwd: directory, env, execPath: process.execPath, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('UMD 候选 worker 超时')); }, 20_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('message', value => {
      try { assert.equal(record(value).ok, true); resolve(undefined); }
      catch (error) { reject(error); }
      finally { clearTimeout(timer); }
    });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`UMD 候选 worker 退出 ${code}`)); });
    child.send({ bytes: new Uint8Array(makeUmdFixture()) });
  });
}

/** @param {string} base @param {import('./release-manifest.mjs').ReleaseManifest} manifest */
export async function runHttpSmokeChecks(base, manifest) {
  /** @param {string} resource @param {RequestInit} [options] */
  const request = (resource, options = {}) => fetch(base + resource, { ...options, signal: AbortSignal.timeout(60_000) });
  const home = await request('/'); assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy') ?? '', /object-src 'none'/);
  const initially = await request('/api/library'); assert.deepEqual(await initially.json(), []);
  assert.equal((await request('/api/library', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  const staticFile = manifest.files.find(file => file.path.startsWith(`${manifest.distDir}/static/`) && file.path.endsWith('.js'));
  assert.ok(staticFile); assert.equal((await request('/_next/static/' + staticFile.path.split('/static/')[1])).status, 200);
  for (const file of ['/vendor/foliate/epub.js', '/vendor/foliate/view.js', '/vendor/pdfjs/pdf.worker.min.mjs', '/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf']) assert.equal((await request(file)).status, 200, file);
  const fixtures = await smokeFixtures();
  /** @type {Record<string, unknown> | undefined} */
  let textBook;
  for (const fixture of fixtures) {
    const form = new FormData(); form.set('file', new Blob([new Uint8Array(fixture.bytes)]), fixture.name);
    const response = await request('/api/import', { method: 'POST', body: form });
    const value = record(await response.json());
    assert.equal(response.status, 200, `${fixture.name}: ${JSON.stringify(value)}`);
    assert.equal(typeof value.id, 'string'); assert.equal(typeof value.editionId, 'string');
    assert.ok(Array.isArray(value.chapters) && value.chapters.length > 0, fixture.name);
    const original = await request(`/api/books/${value.id}/original?editionId=${value.editionId}`);
    assert.equal(original.status, 200); assert.match(original.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(hash(new Uint8Array(await original.arrayBuffer())), hash(fixture.bytes), fixture.name + ' 原件不变');
    if (fixture.name.endsWith('.txt')) textBook = value;
  }
  const umd = new FormData(); umd.set('file', new Blob([new Uint8Array(makeUmdFixture())]), 'candidate.umd');
  // WHY：当前 UMD 是候选转换运行时，HTTP 尚未开放；瘦身不能擅自扩大格式支持承诺。
  assert.equal((await request('/api/import', { method: 'POST', body: umd })).status, 415);
  assert.ok(textBook); const editionId = textBook.editionId;
  const chapters = textBook.chapters; assert.ok(Array.isArray(chapters));
  const paragraphs = record(chapters[0]).paragraphs; assert.ok(Array.isArray(paragraphs));
  const paragraph = record(paragraphs[0]); assert.equal(typeof paragraph.text, 'string');
  const selectedText = String(paragraph.text);
  const saved = await request('/api/reading-marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editionId, kind: 'highlight', anchors: [{ paragraphId: paragraph.id, startOffset: 0, endOffset: selectedText.length, selectedText, textHash: hash(selectedText) }] }) });
  assert.equal(saved.status, 201, await saved.text());
  const marks = record(await (await request(`/api/reading-marks?editionId=${editionId}`)).json());
  assert.ok(Array.isArray(marks.marks) && marks.marks.length === 1);
  const library = await (await request('/api/library')).json(); assert.ok(Array.isArray(library)); assert.equal(library.length, fixtures.length);
  return { importedFormats: fixtures.map(fixture => path.extname(fixture.name)), originalFilesUnchanged: true, readingMarkPersisted: true, textEditionId: String(editionId), originProtection: true, umdHttpStillClosed: true, realModelCalled: false };
}

/** @param {{releaseDir: string, port?: number}} options */
export async function smokeRelease(options) {
  const manifest = await verifyRelease(path.resolve(options.releaseDir));
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) throw new Error('发布包平台/架构与当前验证主机不一致');
  const port = await availableSmokePort(options.port ?? 3317);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'judu-release-smoke-'));
  const isolated = path.join(temporary, 'app'), dataDir = path.join(temporary, 'data');
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let logs = '';
  try {
    // WHY：复制到系统临时目录，确保父级也没有原项目 node_modules；只验证打包目录，而不是构建目录的假独立运行。
    await cp(path.resolve(options.releaseDir), isolated, { recursive: true, errorOnExist: true, force: false });
    await verifyRelease(isolated);
    const env = smokeEnvironment(port, dataDir);
    await verifyUmdCandidate(isolated, env);
    const base = `http://127.0.0.1:${port}`;
    /** @param {string} directory */
    async function start(directory) {
      child = spawn(process.execPath, ['start-release.mjs'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const running = child;
      running.stdout?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-24_000); });
      running.stderr?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-24_000); });
      let startupError; let probeFailure;
      running.once('error', error => { startupError = error; });
      for (let attempt = 0; attempt < 120; attempt++) {
        if (startupError) throw startupError;
        if (running.exitCode !== null) throw new Error(`发布进程提前退出：${logs}`);
        try { const response = await fetch(base + '/api/library', { signal: AbortSignal.timeout(1000) }); if (response.status === 200) return; probeFailure = new Error(`启动探测返回 HTTP ${response.status}`); }
        catch (error) { if (!(error instanceof Error)) throw error; probeFailure = error; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`发布服务启动超时：${probeFailure instanceof Error ? probeFailure.message : '无就绪响应'}\n${logs}`, { cause: probeFailure });
    }
    async function stop() {
      assert.ok(child); const running = child; const exited = once(running, 'exit');
      running.kill('SIGTERM');
      const forceStop = setTimeout(() => running.kill('SIGKILL'), 10_000);
      try { await exited; } finally { clearTimeout(forceStop); }
      child = undefined;
      // WHY：再次绑定同一端口证明服务已退出，不把发送 stop 信号当成端口释放验收。
      await availableSmokePort(port);
    }
    await start(isolated);
    const { textEditionId, ...checks } = await runHttpSmokeChecks(base, manifest);
    await stop();
    // WHY：用两个不可覆盖的程序目录切换并回切，数据始终在同一个外部书库；不冒充跨 schema 的降级证明。
    const alternate = path.join(temporary, 'alternate-app');
    await cp(path.resolve(options.releaseDir), alternate, { recursive: true, errorOnExist: true, force: false });
    for (const directory of [alternate, isolated]) {
      await start(directory);
      const library = await (await fetch(base + '/api/library', { signal: AbortSignal.timeout(10_000) })).json();
      assert.ok(Array.isArray(library)); assert.equal(library.length, checks.importedFormats.length);
      const marks = record(await (await fetch(base + '/api/reading-marks?editionId=' + textEditionId, { signal: AbortSignal.timeout(10_000) })).json());
      assert.ok(Array.isArray(marks.marks)); assert.equal(marks.marks.length, 1);
      await stop();
    }
    return { port, portReleased: true, isolatedFromRepository: true, platform: manifest.platform, architecture: manifest.architecture, bytes: manifest.totalBytes,
      dataSurvivedVersionSwitch: true, returnToPreviousDirectory: true, ...checks };
  } catch (error) {
    throw new Error(`独立发布验收失败：${error instanceof Error ? error.message : String(error)}\n${logs}`, { cause: error });
  } finally {
    if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('judu-release-smoke-')) throw new Error('拒绝清理非本次验证目录');
    await rm(resolved, { recursive: true, force: true });
  }
}

/** @param {string[]} args */
export function smokeArguments(args) {
  const result = { releaseDir: '', port: 3317, report: '' };
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${args[index]}`);
    if (args[index] === '--release-dir') result.releaseDir = value;
    else if (args[index] === '--port') result.port = Number(value);
    else if (args[index] === '--report') result.report = value;
    else throw new Error(`未知参数：${args[index]}`);
  }
  if (!result.releaseDir) throw new Error('必须指定 --release-dir');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = smokeArguments(process.argv.slice(2));
  const result = await smokeRelease(options);
  const report = JSON.stringify(result, null, 2) + '\n';
  if (options.report) await writeFile(path.resolve(options.report), report, { flag: 'wx' });
  console.log(report);
}
