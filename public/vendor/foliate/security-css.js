import { parse, generate, walk } from './vendor/csstree.esm.js'

const functions = new Set(('calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix ' +
    'linear-gradient radial-gradient repeating-linear-gradient repeating-radial-gradient ' +
    'translate translatex translatey translate3d scale scalex scaley rotate matrix matrix3d ' +
    'cubic-bezier steps format local counter counters symbols').split(' '))
const atRules = new Set(['media', 'supports', 'font-face', 'page', 'layer', 'keyframes', '-webkit-keyframes'])

// WHY：用 CSS AST 而非正则猜测 URL；未知语法/动态变量失败关闭，避免字符串式 image-set 等绕过。
export async function sanitizeCss(source, resolve, inline = false) {
    if (source.length > 2 * 1024 * 1024) throw new Error('EPUB CSS exceeds 2 MiB')
    if (/[\\\u0000-\u0008\u000b\u000e-\u001f]/.test(source)) return ''
    const ast = parse(source, { context: inline ? 'declarationList' : 'stylesheet' })
    const jobs = []
    walk(ast, {
        visit: 'Atrule',
        enter(node, item, list) {
            const name = node.name.toLowerCase()
            // Imports are deliberately dropped: linked package-local stylesheets still work.
            if (!atRules.has(name)) { list.remove(item); return this.skip }
            if (node.prelude) {
                let unsafe = false
                walk(node.prelude, n => { if (['Url', 'Raw'].includes(n.type)) unsafe = true })
                if (unsafe) { list.remove(item); return this.skip }
            }
        },
    })
    walk(ast, {
        visit: 'Declaration',
        enter(node, item, list) {
            let unsafe = node.property.startsWith('--') || /^(?:behavior|-moz-binding)$/i.test(node.property)
            const urls = []
            walk(node.value, n => {
                if (n.type === 'Raw') unsafe = true
                if (n.type === 'Function' && !functions.has(n.name.toLowerCase())) unsafe = true
                if (n.type === 'Url') urls.push(n)
            })
            if (unsafe) { list.remove(item); return this.skip }
            let removed = false
            for (const url of urls) jobs.push(async () => {
                const resolved = await resolve(url.value)
                if (resolved) url.value = resolved
                else if (!removed) { list.remove(item); removed = true }
            })
        },
    })
    // No uninterpreted recovery fragments may reach the browser's more permissive CSS parser.
    let raw = false
    walk(ast, node => { if (node.type === 'Raw') raw = true })
    if (raw) return ''
    for (const job of jobs) await job()
    return generate(ast)
}
