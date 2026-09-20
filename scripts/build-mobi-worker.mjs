// @ts-check
import { build, version as esbuildVersion } from 'esbuild';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string | Uint8Array} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** 构建私有单文件运行时，部署和解析进程均不再依赖源码树或开发依赖目录。
 * @param {{outDir?: string}} [options]
 */
export async function buildMobiWorker(options = {}) {
  const outDir = path.resolve(options.outDir ?? path.join(root, 'runtime/mobi'));
  const config = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (esbuildVersion !== config.devDependencies.esbuild) throw new Error('MOBI构建器版本与固定依赖不符');
  const provenance = JSON.parse(await readFile(path.join(root, 'vendor/mobi/PROVENANCE.json'), 'utf8'));
  const vendor = await readFile(path.join(root, 'vendor/mobi/index.mjs'));
  if (sha256(vendor) !== provenance.patchedSha256) throw new Error('MOBI vendor与已审查哈希不一致');
  // WHY：CJS允许Node内置require；所有第三方依赖均打进worker，运行时不授权整个node_modules。
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/lib/mobi-worker.mjs'], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', write: false, metafile: true,
    outfile: 'worker.cjs', legalComments: 'inline', logLevel: 'silent',
  });
  const output = result.outputFiles?.[0];
  if (!output || result.outputFiles.length !== 1 || !result.metafile) throw new Error('MOBI运行时产物不完整');
  for (const file of Object.values(result.metafile.outputs)) {
    if (file.imports.some(item => !item.external || !isBuiltin(item.path))) throw new Error('MOBI运行时仍有未打包的外部依赖');
  }
  const inputs = await Promise.all(Object.keys(result.metafile.inputs).sort().map(async name => ({
    path: name.replaceAll('\\', '/'), sha256: sha256(await readFile(path.resolve(root, name))),
  })));
  const packages = new Set(inputs.flatMap(input => {
    const relative = input.path.split('node_modules/').at(-1);
    if (!input.path.includes('node_modules/') || !relative) return [];
    const parts = relative.split('/');
    return [parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]];
  }));
  const licenses = [];
  for (const name of [...packages].sort()) {
    const folder = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    let text;
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT.txt']) {
      try { text = await readFile(path.join(folder, file), 'utf8'); break; }
      catch (cause) { if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause; }
    }
    if (!text) throw new Error(`MOBI运行时依赖缺少许可：${name}`);
    licenses.push({ name, version: pkg.version, license: pkg.license, text });
  }
  licenses.unshift({ name: provenance.package, version: provenance.version, license: provenance.license,
    text: await readFile(path.join(root, 'vendor/mobi/LICENSE'), 'utf8') });
  const notice = licenses.map(item => `## ${item.name}@${item.version} (${item.license})\n\n${item.text.trim()}\n`).join('\n');
  const manifest = { schemaVersion: 1, entry: 'worker.cjs', sha256: sha256(output.contents),
    licenseSha256: sha256(notice), packages: licenses.map(({ name, version, license }) => ({ name, version, license })), inputs,
    // WHY：固定构建输入，不放时间戳/机器路径；两次构建必须逐字节可复现。
    esbuildVersion, generator: 'scripts/build-mobi-worker.mjs', generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    lockSha256: sha256(await readFile(path.join(root, 'package-lock.json'))),
  };
  await mkdir(outDir, { recursive: true });
  // WHY：pretest/predev可能与正在运行的实例并存，先写私有临时文件再原子发布，不能截断在用worker。
  const pending = path.join(outDir, `.worker-${randomUUID()}.pending`);
  try {
    await writeFile(pending, output.contents, { flag: 'wx' });
    await rename(pending, path.join(outDir, 'worker.cjs'));
  } finally { await rm(pending, { force: true }); }
  await writeFile(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'), notice);
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory: outDir, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest } = await buildMobiWorker();
  console.log(`MOBI私有运行时已构建（${manifest.packages.length}份许可）；导入入口仍未开放`);
}
