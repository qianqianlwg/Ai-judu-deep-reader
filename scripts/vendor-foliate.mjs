import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const revision = '78914aef4466eb960965702401634c2cb348e9b1';
const files = ['epub.js', 'epubcfi.js', 'view.js', 'progress.js', 'overlayer.js', 'text-walker.js',
  'paginator.js', 'fixed-layout.js', 'search.js', 'tts.js', 'LICENSE', 'vendor/zip.js'];
const upstream = process.argv.find((arg, i) => i >= 2 && arg !== '--check');
if (!upstream) throw new Error('Usage: node scripts/vendor-foliate.mjs <official-upstream-clone> [--check]');
const run = promisify(execFile), check = process.argv.includes('--check');
const git = async args => (await run('git', ['-C', resolve(upstream), ...args], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 })).stdout;
if ((await git(['rev-parse', 'HEAD'])).toString().trim() !== revision) throw new Error('Wrong upstream commit');
const root = resolve('public/vendor/foliate');
const records = [];
function patch(name, source) {
  let text = source.toString('utf8');
  if (name === 'paginator.js' || name === 'fixed-layout.js') {
    if (!text.includes("'allow-same-origin allow-scripts'")) throw new Error('Sandbox patch no longer matches');
    text = text.replace("'allow-same-origin allow-scripts'", "'allow-same-origin'");
  }
  if (name === 'view.js') {
    const start = text.indexOf('const isZip ='), end = text.indexOf('class CursorAutohider');
    if (start < 0 || end < start) throw new Error('Raw-loader patch no longer matches');
    text = text.slice(0, start) + '// WHY：本项目只接受安全层已校验的 EPUB；移除上游 URL/ZIP/其他格式的绕过入口。\n'
      + "export const makeBook = async () => {\n    throw new Error('Use the sanitized EPUB loader')\n}\n\n" + text.slice(end);
    text = text.replace('this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }',
      'this.lastLocation = { ...progress, tocItem, pageItem, cfi, range, index }');
  }
  if (name === 'paginator.js') {
    text = text.replaceAll('        if (!this.#view) return', '        if (!this.#view?.document?.body) return')
      .replaceAll('        if (!layout) return', '        if (!layout || !this.document?.body) return')
      .replaceAll('then(() => this.#view.expand())', 'then(() => this.#view?.expand())')
      .replaceAll('        this.#view.destroy()', '        this.#view?.destroy()')
      .replaceAll('if (this.document) this.#observer.unobserve(this.document.body)',
        'if (this.document?.body) this.#observer.unobserve(this.document.body)')
      .replace('        requestAnimationFrame(() =>\n            this.#background.style.background = getBackground(this.#view.document))',
        '        requestAnimationFrame(() => {\n            if (this.#view?.document?.body)\n                this.#background.style.background = getBackground(this.#view.document)\n        })');
  }
  return Buffer.from(text);
}
for (const name of files) {
  // WHY：读取 git 对象而非工作树，避免把未提交修改当作固定版本分发。
  const original = await git(['show', `${revision}:${name}`]);
  const output = patch(name, original), destination = resolve(root, name);
  if (check) {
    if (!(await readFile(destination)).equals(output)) throw new Error(`Vendor mismatch: ${name}`);
  } else {
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, output);
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  records.push({ path: name, sourceSha256: hash(original), distributedSha256: hash(output), patched: !original.equals(output) });
}
const cssRoot = resolve('node_modules/css-tree');
if (JSON.parse(await readFile(resolve(cssRoot, 'package.json'), 'utf8')).version !== '3.2.1') throw new Error('Expected CSS Tree 3.2.1');
for (const [source, name] of [['dist/csstree.esm.js', 'vendor/csstree.esm.js'], ['LICENSE', 'vendor/LICENSE-css-tree']]) {
  const bytes = await readFile(resolve(cssRoot, source));
  if (check) {
    if (!(await readFile(resolve(root, name))).equals(bytes)) throw new Error(`Vendor mismatch: ${name}`);
  } else await writeFile(resolve(root, name), bytes);
  records.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const manifest = JSON.stringify({ upstream: 'https://github.com/johnfactotum/foliate-js', revision,
  zip: { version: '2.8.22', license: 'BSD-3-Clause' }, cssTree: { version: '3.2.1', license: 'MIT' }, files: records }, null, 2) + '\n';
if (check) {
  if (await readFile(resolve(root, 'PROVENANCE.json'), 'utf8') !== manifest) throw new Error('Provenance mismatch');
} else await writeFile(resolve(root, 'PROVENANCE.json'), manifest);
console.log(`${check ? 'Verified' : 'Vendored'} foliate-js ${revision}; ${records.length} pinned files; no network used.`);
