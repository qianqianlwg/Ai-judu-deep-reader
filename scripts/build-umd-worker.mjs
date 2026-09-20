// @ts-check
import { build, version as esbuildVersion } from 'esbuild';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @param {string | Uint8Array} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/** @param {{outDir?: string}} [options] */
export async function buildUmdWorker(options = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (config.devDependencies.esbuild !== esbuildVersion) throw new Error('UMD构建器版本不匹配');
  const directory = path.resolve(options.outDir ?? path.join(root, 'runtime/umd'));
  const output = await build({ absWorkingDir: root, entryPoints: ['src/lib/umd-worker.ts'], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', write: false, metafile: true, outfile: 'worker.cjs', logLevel: 'silent' });
  if (output.warnings.length || output.outputFiles?.length !== 1 || !output.metafile) throw new Error('UMD运行时构建不完整或有警告');
  for (const file of Object.values(output.metafile.outputs)) if (file.imports.some(item => !item.external || !isBuiltin(item.path))) throw new Error('UMD运行时含非内置依赖');
  const inputs = await Promise.all(Object.keys(output.metafile.inputs).sort().map(async file => {
    if (file.includes('node_modules')) throw new Error('UMD解析器不得隐式引入第三方运行时源码');
    return { path: file.replaceAll('\\', '/'), sha256: hash(await readFile(path.resolve(root, file))) };
  }));
  const manifest = { schemaVersion: 1, entry: 'worker.cjs', esbuildVersion, inputs, sha256: hash(output.outputFiles[0].contents),
    generatorSha256: hash(await readFile(fileURLToPath(import.meta.url))), lockSha256: hash(await readFile(path.join(root, 'package-lock.json'))) };
  await mkdir(directory, { recursive: true }); const pending = path.join(directory, `.worker-${randomUUID()}.pending`);
  // WHY：并发的开发/测试构建不截断运行时入口，先写临时文件再原子发布。
  try { await writeFile(pending, output.outputFiles[0].contents, { flag: 'wx' }); await rename(pending, path.join(directory, 'worker.cjs')); }
  finally { await rm(pending, { force: true }); }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory, manifest };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildUmdWorker(); console.log('UMD私有候选运行时已构建；导入入口未开放');
}
