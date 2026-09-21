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
    // WHY：初始化首章走goToTextStart/goTo；只写console会把文档加载失败伪装成ready，必须交给调用方恢复。
    const failedNavigation = '            console.error(`Could not go to ${target}`)';
    if (!text.includes(failedNavigation)) throw new Error('Navigation error patch no longer matches');
    text = text.replace(failedNavigation, failedNavigation + '\n            throw e');
    text = text.replace('this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }',
      'this.lastLocation = { ...progress, tocItem, pageItem, cfi, range, index }');
  }
  if (name === 'paginator.js') {
    // WHY：只修复原生iframe生命周期：空白加载不得当正文，事件异常必须reject，关闭须终结等待；不改运输、sandbox或shadow。
    const nativeLoad = `    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(\`\${src} is not string\`)
        return new Promise(resolve => {
            this.#iframe.addEventListener('load', () => {
                const doc = this.document
                afterLoad?.(doc)

                // it needs to be visible for Firefox to get computed style
                this.#iframe.style.display = 'block'
                const { vertical, rtl } = getDirection(doc)
                const background = getBackground(doc)
                this.#iframe.style.display = 'none'

                this.#vertical = vertical
                this.#rtl = rtl

                this.#contentRange.selectNodeContents(doc.body)
                const layout = beforeRender?.({ vertical, rtl, background })
                this.#iframe.style.display = 'block'
                this.render(layout)
                this.#observer.observe(doc.body)

                // the resize observer above doesn't work in Firefox
                // (see https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)
                // until the bug is fixed we can at least account for font load
                doc.fonts.ready.then(() => this.expand())

                resolve()
            }, { once: true })
            this.#iframe.src = src
        })
    }
`;
    const settledLoad = `    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(\`\${src} is not string\`)
        if (this.#destroyed) throw new DOMException('阅读文档已关闭', 'AbortError')
        this.#cancelLoad?.()
        this.#loaded = false
        return new Promise((resolve, reject) => {
            let settled = false
            const cleanup = () => {
                settled = true
                this.#iframe.removeEventListener('load', loaded)
                this.#iframe.removeEventListener('error', failed)
                this.#cancelLoad = null
            }
            const fail = error => { cleanup(); reject(error) }
            const failed = () => fail(new Error('原版章节文档加载失败，请重试。'))
            const loaded = () => {
                try {
                    const doc = this.document
                    // WHY：插入iframe时的about:blank事件不代表目标章节就绪，不能提前消耗一次性监听。
                    if (!doc || doc.URL === 'about:blank') return
                    if (doc.URL.split('#')[0] !== src.split('#')[0]) return
                    if (!doc.body) throw new Error('原版章节缺少可渲染正文')
                    afterLoad?.(doc)
                    if (settled) return
                    this.#iframe.style.display = 'block'
                    const { vertical, rtl } = getDirection(doc)
                    const background = getBackground(doc)
                    this.#iframe.style.display = 'none'
                    this.#vertical = vertical
                    this.#rtl = rtl
                    this.#contentRange.selectNodeContents(doc.body)
                    const layout = beforeRender?.({ vertical, rtl, background })
                    if (settled) return
                    this.#iframe.style.display = 'block'
                    this.#loaded = true
                    this.render(layout)
                    if (settled) return
                    this.#observer.observe(doc.body)
                    doc.fonts.ready.then(() => {
                        if (!this.#destroyed && this.#loaded) this.expand()
                    }).catch(error => console.error('原版字体布局失败', error))
                    cleanup()
                    resolve()
                } catch (error) {
                    // WHY：DOM事件内的异常不会自动拒绝外层Promise；必须传回调用方，不能等20秒假超时。
                    this.#loaded = false
                    fail(error)
                }
            }
            this.#cancelLoad = () => fail(new DOMException('阅读文档加载已取消', 'AbortError'))
            this.#iframe.addEventListener('load', loaded)
            this.#iframe.addEventListener('error', failed)
            try { this.#iframe.src = src }
            catch (error) { fail(error) }
        })
    }
`;
    if (!text.includes(nativeLoad)) throw new Error('Native frame lifecycle patch no longer matches');
    text = text.replace(nativeLoad, settledLoad)
      .replace('class View {\n', 'class View {\n    #cancelLoad\n    #loaded = false\n    #destroyed = false\n')
      .replace('        if (!layout) return', '        if (this.#destroyed || !this.#loaded || !layout || !this.document?.body) return')
      .replace('    expand() {\n        const { documentElement }', '    expand() {\n        if (this.#destroyed || !this.#loaded || !this.document?.body) return\n        const { documentElement }')
      .replace('    destroy() {\n        if (this.document) this.#observer.unobserve(this.document.body)\n    }', '    destroy() {\n        this.#destroyed = true\n        this.#loaded = false\n        this.#cancelLoad?.()\n        this.#observer.disconnect()\n    }');
    // WHY：外层可能还在等section.load，内部iframe的destroy无法取消这段等待；每个await后也须防止迟到续行。
    const replacePaginator = (before, after) => {
      if (!text.includes(before)) throw new Error('Paginator lifecycle patch no longer matches: ' + before.slice(0, 80));
      text = text.replace(before, after);
    };
    replacePaginator(`export class Paginator extends HTMLElement {`, `export class Paginator extends HTMLElement {
    #lifecycle = new AbortController()`);
    replacePaginator(`    #createView() {`, `    #createView() {
        this.#lifecycle.signal.throwIfAborted()`);
    replacePaginator(`    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise`, `    // WHY：销毁立即结束外层导航等待，并消费底层迟到拒绝；不改变原生blob/iframe运输。
    #waitFor(work) {
        const { signal } = this.#lifecycle
        return new Promise((resolve, reject) => {
            let settled = false
            const finish = (callback, value) => {
                if (settled) return
                settled = true
                signal.removeEventListener('abort', abort)
                callback(value)
            }
            const abort = () => finish(reject, signal.reason)
            Promise.resolve(work).then(value => finish(resolve, value), error => finish(reject, error))
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
        })
    }
    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await this.#waitFor(promise)
        this.#lifecycle.signal.throwIfAborted()`);
    replacePaginator(`            await view.load(src, afterLoad, beforeRender)`, `            await this.#waitFor(view.load(src, afterLoad, beforeRender))
            this.#lifecycle.signal.throwIfAborted()`);
    replacePaginator(`            this.#view = view`, `            this.#lifecycle.signal.throwIfAborted()
            this.#view = view`);
    replacePaginator(`        await this.scrollToAnchor((typeof anchor === 'function'
            ? anchor(this.#view.document) : anchor) ?? 0, select)
        if (hasFocus) this.focusView()`, `        const target = (typeof anchor === 'function' ? anchor(this.#view.document) : anchor) ?? 0
        this.#lifecycle.signal.throwIfAborted()
        await this.#waitFor(this.scrollToAnchor(target, select))
        this.#lifecycle.signal.throwIfAborted()
        if (hasFocus) this.focusView()`);
    replacePaginator(`    async #goTo({ index, anchor, select}) {`, `    async #goTo({ index, anchor, select}) {
        this.#lifecycle.signal.throwIfAborted()`);
    replacePaginator(`                .then(src => ({ index, src, anchor, onLoad, select }))
                .catch(e => {
                    console.warn(e)
                    console.warn(new Error(\`Failed to load section \${index}\`))
                    return {}
                }))`, `                .then(src => ({ index, src, anchor, onLoad, select })))`);
    replacePaginator(`    async goTo(target) {
        if (this.#locked) return
        const resolved = await target`, `    async goTo(target) {
        if (this.#locked && !this.#lifecycle.signal.aborted) return
        const resolved = await this.#waitFor(target)
        this.#lifecycle.signal.throwIfAborted()`);
    replacePaginator(`    async #turnPage(dir, distance) {
        if (this.#locked) return
        this.#locked = true
        const prev = dir === -1
        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
        if (shouldGo) await this.#goTo({
            index: this.#adjacentIndex(dir),
            anchor: prev ? () => 1 : () => 0,
        })
        if (shouldGo || !this.hasAttribute('animated')) await wait(100)
        this.#locked = false
    }`, `    async #turnPage(dir, distance) {
        this.#lifecycle.signal.throwIfAborted()
        if (this.#locked) return
        this.#locked = true
        try {
            const prev = dir === -1
            const shouldGo = await this.#waitFor(prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
            this.#lifecycle.signal.throwIfAborted()
            if (shouldGo) await this.#goTo({
                index: this.#adjacentIndex(dir),
                anchor: prev ? () => 1 : () => 0,
            })
            if (shouldGo || !this.hasAttribute('animated')) await this.#waitFor(wait(100))
        } finally {
            // WHY：章节错误现在向上传播，锁必须在失败/取消时一并释放。
            this.#locked = false
        }
    }`);
    replacePaginator(`    destroy() {
        this.#observer.unobserve(this)`, `    destroy() {
        if (this.#lifecycle.signal.aborted) return
        this.#lifecycle.abort(new DOMException('阅读分页器已关闭', 'AbortError'))
        this.#observer.disconnect()`);
    replacePaginator(`        this.sections[this.#index]?.unload?.()`, `        this.sections?.[this.#index]?.unload?.()`);
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
