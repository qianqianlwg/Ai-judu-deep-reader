// @ts-check
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMobiPatches } from './mobi-vendor-patches.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/@lingo-reader/mobi-parser');
const target = path.join(root, 'vendor/mobi');
const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
if (pkg.version !== '0.4.6') throw new Error('MOBI候选版本改变，必须重新审查');
const input = await readFile(path.join(source, 'dist/index.node.mjs'), 'utf8');
const license = await readFile(path.join(source, 'LICENSE'));
/** @param {string|Uint8Array} value */
const sha256 = value => createHash('sha256').update(value).digest('hex');
if (sha256(input) !== '37ceb6f781bb0b83024c86c0baa782d154dd3e8c5c72234fcb44dfe2f5d3682a'
 || sha256(license) !== '995c6c256b13ced9b14de5bbc2b03d1d1648576c84cd2e96f995d7094c83d08e') throw new Error('MOBI固定源码/许可校验失败');
const result = '// Vendored from @lingo-reader/mobi-parser@0.4.6 (MIT); see LICENSE and PROVENANCE.json.\n' + applyMobiPatches(input);
const manifest = JSON.stringify({package:pkg.name,version:pkg.version,license:'MIT',sourceSha256:sha256(input),licenseSha256:sha256(license),patchedSha256:sha256(result),patches:['absent-EXTH','single-flow-KF8-FDST','bounded-raw-flow','last-MOBI-byte-range','body-tag-attributes'],generator:'scripts/vendor-mobi.mjs'},null,2)+'\n';
for (const [name, bytes] of [['index.mjs', result], ['LICENSE',license], ['PROVENANCE.json',manifest]]) {
  const dest=path.join(target,String(name));
  if (process.argv.includes('--check')) { if (!(await readFile(dest)).equals(Buffer.from(bytes))) throw new Error('MOBI vendored mismatch: '+name); }
  else { await mkdir(target,{recursive:true}); await writeFile(dest,bytes); }
}
console.log(process.argv.includes('--check')?'MOBI离线源码/补丁/许可一致':'已生成固定候选MOBI源码，生产入口仍未开放');
