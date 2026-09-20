// No HTTP server or listening port: Playwright fulfills every trusted request from local files.
import { readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core')
const root = resolve('public/vendor/foliate')
const fixture = await readFile(process.env.EPUB_FIXTURE || resolve(root, 'fixtures/security.epub'))
const bundle = await build({ entryPoints: ['src/lib/epub-loader.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const origin = process.env.EPUB_TEST_ORIGIN || 'https://epub-test.invalid'
const browser = await chromium.launch({ headless: true })
const requests = [], unexpected = [], errors = []
try {
    const page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.stack))
    await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        requests.push(url.href)
        const headers = { 'Content-Security-Policy': "img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" }
        if (url.origin !== origin) { unexpected.push(url.href); return route.abort() }
        if (process.env.EPUB_TEST_ORIGIN && url.pathname !== '/loader.js') return route.continue()
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', headers, body: '<!doctype html><html><head><title>EPUB offline smoke</title></head><body></body></html>' })
        if (url.pathname === '/loader.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
        if (url.pathname.startsWith('/vendor/foliate/')) {
            const path = resolve(root, url.pathname.slice('/vendor/foliate/'.length))
            const sub = relative(root, path)
            if (!sub.startsWith(`..${sep}`) && !sub.startsWith('..') && path.endsWith('.js'))
                return route.fulfill({ contentType: 'text/javascript', body: await readFile(path) })
        }
        unexpected.push(url.href)
        return route.abort()
    })
    await page.goto(origin + '/')
    const result = await page.evaluate(async data => {
        const { loadEpub, createFoliateView } = await import('/loader.js')
        const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
        const book = await loadEpub(new Blob([bytes]))
        const view = await createFoliateView()
        view.style.cssText = 'display:block;width:557px;height:541px;position:fixed;inset:0;z-index:999999;background:white'
        document.body.append(view)
        await view.open(book)
        view.renderer.setStyles('body { font-size: 18px; }')
        let loads = 0
        view.addEventListener('load', () => { loads++ })
        await view.init({ showTextStart: true })
        const [{ doc, index }] = view.renderer.getContents()
        const range = doc.createRange()
        range.selectNodeContents(doc.querySelector('p').firstChild)
        const cfi = view.getCFI(index, range)
        const resolved = view.resolveCFI(cfi)
        await view.renderer.goTo({ index: resolved.index, anchor: resolved.anchor })
        const output = {
            sizes: book.sections.map(({id,size})=>({id,size})), fraction: view.lastLocation.fraction, loads, id: book.sections[index].id, cfi,
            roundtrip: resolved.anchor(doc).toString(), selection: range.toString(),
            csp: doc.querySelector('head meta').getAttribute('content'),
            image: { src: doc.querySelector('img').src, loaded: doc.querySelector('img').complete, width: doc.querySelector('img').naturalWidth },
            evil: Boolean(window.evil), scripts: doc.querySelectorAll('script,[onerror],[srcset]').length,
            math: doc.querySelector('math mi').textContent,
            locationIndex: view.lastLocation.index,
        }
        await view.next(); await view.prev()
        // Exercise the fixed-layout bridge adapters using the same sanitized chapter.
        view.close()
        book.rendition = { ...book.rendition, layout: 'pre-paginated' }
        await view.open(book)
        view.renderer.setStyles('body { color: black; }')
        await view.init({ showTextStart: true })
        output.fixed = { fixed: view.isFixedLayout, indices: view.renderer.getContents().map(x => x.index) }
        view.close(); book.destroy(); view.remove()
        const empty = await createFoliateView()
        document.body.append(empty)
        empty.style.cssText = 'display:block;width:0;height:0'
        try { await empty.init({}); output.zeroSizeRejected = false }
        catch (error) { output.zeroSizeRejected = error.message.includes('容器尺寸无效') }
        empty.close(); empty.remove()
        return output
    }, fixture.toString('base64'))
    if (!process.env.EPUB_FIXTURE) assert.equal(result.id, 'EPUB/text/chapter.xhtml')
    assert.equal(result.roundtrip, result.selection)
    assert.equal(result.evil, false)
    assert.equal(result.scripts, 0)
    assert.equal(result.math, 'x')
    assert.ok(result.csp.includes("script-src 'none'"))
    assert.ok(result.image.width > 0)
    assert.equal(result.locationIndex, 0)
    assert.ok(Number.isFinite(result.fraction))
    assert.ok(result.loads >= 1)
    assert.equal(result.zeroSizeRejected, true)
    assert.deepEqual(result.fixed, { fixed: true, indices: [0] })
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ result, trustedRequests: requests.length, unexpected, errors, serverStarted: false }, null, 2))
} finally {
    await browser.close()
}
