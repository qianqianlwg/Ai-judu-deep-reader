import { EPUB } from './epub.js'
import { View } from './view.js'
import { configure, ZipReader, BlobReader } from './vendor/zip.js'
import { sanitizeCss } from './security-css.js'

export const revision = '78914aef4466eb960965702401634c2cb348e9b1'
configure({ useWebWorkers: false, useCompressionStream: true })

export async function openArchive(blob) {
    const reader = new ZipReader(new BlobReader(blob), { checkSignature: true, checkOverlappingEntry: true })
    try {
        const entries = (await reader.getEntries()).map(entry => ({
            filename: entry.filename, directory: entry.directory, encrypted: entry.encrypted,
            compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize,
            async read(limit) {
                let size = 0, exceeded = false
                const chunks = []
                // WHY：不能依赖 ZIP 头声明的大小；在解压输出流写入前限制真实字节数。
                const sink = new WritableStream({
                    write(chunk) {
                        size += chunk.byteLength
                        if (size > limit || size > entry.uncompressedSize) {
                            exceeded = true
                            throw new Error('EPUB decompression output limit exceeded')
                        }
                        chunks.push(chunk.slice())
                    },
                })
                try { await entry.getData(sink, { checkSignature: true, useWebWorkers: false }) }
                catch (error) {
                    if (exceeded) throw new Error('EPUB decompression output limit exceeded', { cause: error })
                    throw error
                }
                if (size !== entry.uncompressedSize) throw new Error('EPUB ZIP size mismatch')
                const result = new Uint8Array(size)
                let offset = 0
                for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
                return result
            },
        }))
        return { entries, close: () => reader.close() }
    } catch (error) {
        await reader.close()
        throw error
    }
}

export async function createBook(_original, loader) {
    // WHY：只接受经过安全层校验的 EPUB，不提供原始 ZIP/HTML 绕过入口。
    if (!loader?.loadText || !loader?.loadBlob || !loader?.getSize)
        throw new Error('A sanitized EPUB resource loader is required')
    const book = new EPUB(loader)
    try { return await book.init() }
    catch (error) { book.destroy(); throw error }
}

function textEndpointRange(source) {
    if (!source || source.collapsed || !source.toString()) return source
    const document = source.startContainer.ownerDocument
    const root = source.commonAncestorContainer
    const walker = document.createTreeWalker(root, 4)
    const nodes = root.nodeType === 3 ? [root] : []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
    const selected = nodes.filter(node => {
        if (!node.length) return false
        const probe = document.createRange()
        probe.selectNodeContents(node)
        return source.compareBoundaryPoints(3, probe) < 0 && source.compareBoundaryPoints(1, probe) > 0
    })
    if (!selected.length) return source
    const first = selected[0], last = selected[selected.length - 1], range = source.cloneRange()
    range.setStart(first, first === source.startContainer ? source.startOffset : 0)
    range.setEnd(last, last === source.endContainer ? source.endOffset : last.length)
    return range.toString() === source.toString() ? range : source
}

export function createView() {
    const view = new View()
    const getCFI = view.getCFI.bind(view)
    // WHY：固定版CFI工具会折叠元素端点的文字选区；只将同文Range端点规范为Text，原Range/正文/运输均不修改。
    view.getCFI = (index, range) => getCFI(index, textEndpointRange(range))
    const open = view.open.bind(view)
    const init = view.init.bind(view)
    const assertLayout = () => {
        const { width, height } = view.getBoundingClientRect()
        const renderer = view.renderer
        const size = renderer && 'size' in renderer ? renderer.size : width
        if (!view.isConnected || width <= 0 || height <= 0 || !Number.isFinite(size) || size <= 0)
            throw new Error('EPUB 阅读容器尺寸无效，请检查容器宽高后重试：' + width + '×' + height + ' / ' + size)
    }
    view.init = async options => { assertLayout(); return init(options) }
    view.open = async book => {
        if (!book || !Array.isArray(book.sections)) throw new Error('A sanitized book is required')
        await open(book)
        const goTo = view.renderer.goTo.bind(view.renderer)
        view.renderer.goTo = async target => { assertLayout(); return goTo(target) }
        // WHY：上游固定版式 getContents 没有 index/setStyles；统一为主组件所需的窄契约。
        if (view.isFixedLayout) {
            const indices = new WeakMap()
            const contents = view.renderer.getContents.bind(view.renderer)
            view.renderer.addEventListener('load', event => {
                indices.set(event.detail.doc, event.detail.index)
            }, { capture: true })
            view.renderer.getContents = () => contents()
                .filter(({ doc }) => doc && indices.has(doc))
                .map(({ doc }) => ({ doc, index: indices.get(doc) }))
            let styles = ''
            const apply = doc => {
                let el = doc.getElementById('judu-reader-styles')
                if (!el) {
                    el = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style')
                    el.id = 'judu-reader-styles'
                    ;(doc.head || doc.documentElement).append(el)
                }
                el.textContent = styles
            }
            view.renderer.setStyles = css => {
                styles = css
                for (const { doc } of view.renderer.getContents()) apply(doc)
            }
            view.renderer.addEventListener('load', event => apply(event.detail.doc))
        }
    }
    return view
}

if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__juduFoliate', {
        value: Object.freeze({ revision, openArchive, createBook, createView, sanitizeCss }),
        writable: false, configurable: false,
    })
}

export { sanitizeCss }
