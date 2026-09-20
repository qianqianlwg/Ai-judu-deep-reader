import type { EpubArchive, EpubResourceLoader, FoliateBridge } from './foliate-types';
import { EPUB_LIMITS, assertPackagePath, resolvePackageReference } from './epub-security-zip';
import { parseEpubXml, sanitizeDocument, type ResourceKind } from './epub-security-document';

const OPF = 'http://www.idpf.org/2007/opf';
const CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const XHTML = 'application/xhtml+xml', SVG = 'image/svg+xml', CSS = 'text/css';
const docs = new Set([XHTML, 'text/html', SVG]);
const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', SVG]);
const fonts = new Set(['font/otf', 'font/ttf', 'font/woff', 'font/woff2', 'application/font-sfnt', 'application/font-woff', 'application/vnd.ms-opentype']);
const media = new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm', 'video/ogg']);
const NCX = 'application/x-dtbncx+xml';
const allowed = new Set([...docs, ...images, ...fonts, ...media, CSS, NCX]);
export interface SafeEpubResources extends EpubResourceLoader { destroy(): void }

export async function prepareEpubResources(archive: EpubArchive, css: FoliateBridge['sanitizeCss']): Promise<SafeEpubResources> {
  const entries = new Map(archive.entries.filter(entry => !entry.directory).map(entry => [entry.filename, entry]));
  const bytes = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  let total = 0, destroyed = false;
  const read = (path: string) => {
    if (destroyed) throw new Error('EPUB 已销毁');
    const entry = entries.get(path);
    if (!entry) throw new Error(`EPUB 缺少包内资源：${path}`);
    let pending = bytes.get(path);
    if (!pending) {
      pending = entry.read(EPUB_LIMITS.entry).then(data => {
        total += data.byteLength;
        if (total > EPUB_LIMITS.total || data.byteLength !== entry.uncompressedSize)
          throw new Error('EPUB 解压实际大小超过限制');
        return data;
      });
      bytes.set(path, pending);
    }
    return pending;
  };
  const text = async (path: string) => {
    if ((entries.get(path)?.uncompressedSize ?? Infinity) > EPUB_LIMITS.text) throw new Error('EPUB 文本资源超过 2 MiB 限制');
    return new TextDecoder('utf-8', { fatal: true }).decode(await read(path));
  };
  if (await text('mimetype') !== 'application/epub+zip') throw new Error('EPUB mimetype 无效');
  const container = parseEpubXml(await text('META-INF/container.xml'));
  if (container.documentElement.namespaceURI !== CONTAINER || container.documentElement.localName !== 'container')
    throw new Error('EPUB container 命名空间无效');
  const roots = Array.from(container.getElementsByTagNameNS(CONTAINER, 'rootfile'));
  const root = roots.find(el => el.getAttribute('media-type') === 'application/oebps-package+xml');
  const opfPath = assertPackagePath(root?.getAttribute('full-path') ?? '');
  const opf = parseEpubXml(await text(opfPath));
  if (opf.documentElement.namespaceURI !== OPF || opf.documentElement.localName !== 'package') throw new Error('EPUB package 无效');
  // WHY：未知加密不能带入图片/字体解码器；phase1 明确拒绝，不静默显示损坏内容。
  if (entries.has('META-INF/encryption.xml')) throw new Error('phase1 暂不支持加密或字体混淆的 EPUB');
  const manifest = Array.from(opf.getElementsByTagNameNS(OPF, 'manifest'));
  const spines = Array.from(opf.getElementsByTagNameNS(OPF, 'spine'));
  if (manifest.length !== 1 || spines.length !== 1) throw new Error('EPUB manifest/spine 必须唯一');
  const types = new Map<string, string>(), ids = new Map<string, string>(), seenPaths = new Set<string>();
  for (const item of Array.from(manifest[0].children)) {
    if (item.namespaceURI !== OPF || item.localName !== 'item') throw new Error('EPUB manifest item 无效');
    const id = item.getAttribute('id'), type = item.getAttribute('media-type') ?? '';
    const reference = resolvePackageReference(item.getAttribute('href') ?? '', opfPath);
    if (!id || ids.has(id) || !reference || reference.fragment || !entries.has(reference.path) || seenPaths.has(reference.path))
      throw new Error('EPUB manifest 包外路径、缺失资源或重复 ID/href');
    ids.set(id, reference.path); seenPaths.add(reference.path);
    if (!allowed.has(type)) { item.remove(); continue; }
    types.set(reference.path, type);
    item.removeAttribute('media-overlay');
    item.removeAttribute('fallback');
    item.setAttribute('properties', (item.getAttribute('properties') ?? '').split(/\s+/).filter(p => p !== 'scripted' && p !== 'remote-resources').join(' '));
  }
  const svgSpines = new Set<string>();
  const spine = Array.from(spines[0].children);
  if (!spine.length) throw new Error('EPUB 没有章节');
  for (const ref of spine) {
    const path = ids.get(ref.getAttribute('idref') ?? '');
    if (ref.namespaceURI !== OPF || ref.localName !== 'itemref' || !path || !docs.has(types.get(path) ?? ''))
      throw new Error('EPUB spine 只能引用包内 XHTML/SVG 章节');
    if (types.get(path) === SVG) svgSpines.add(path);
  }
  // SVG spine documents need an HTML head for a CSP that precedes all renderable content.
  for (const item of Array.from(manifest[0].children)) {
    const path = ids.get(item.getAttribute('id') ?? '');
    if (path && (svgSpines.has(path) || types.get(path) === 'text/html')) item.setAttribute('media-type', XHTML);
  }
  const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
  const texts = new Map<string, string>(), urls = new Map<string, string>(), owned = new Set<string>();
  const relative = (path: string, from: string) => {
    const a = from.split('/').slice(0, -1), b = path.split('/');
    while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
    return [...a.map(() => '..'), ...b].map(encodeURIComponent).join('/');
  };
  const navigation = (value: string, base: string) => {
    const ref = resolvePackageReference(value, base);
    return ref && docs.has(types.get(ref.path) ?? '')
      ? (ref.path === base && ref.fragment ? '' : relative(ref.path, base)) + ref.fragment : null;
  };
  for (const ref of Array.from(opf.getElementsByTagNameNS(OPF, 'reference'))) {
    const value = navigation(ref.getAttribute('href') ?? '', opfPath);
    if (value) ref.setAttribute('href', value); else ref.remove();
  }
  texts.set(opfPath, serialize(opf));
  texts.set('META-INF/container.xml', serialize(container));
  const resource = async (value: string, base: string, kind: ResourceKind, parents: string[]): Promise<string | null> => {
    const ref = resolvePackageReference(value, base);
    if (!ref) return null;
    if (!value.split('#')[0] && ref.fragment && kind !== 'style' && kind !== 'media') return ref.fragment;
    const type = types.get(ref.path) ?? '';
    const permitted = kind === 'style' ? type === CSS : kind === 'image' ? images.has(type)
      : kind === 'media' ? media.has(type) : images.has(type) || fonts.has(type);
    if (!permitted || parents.includes(ref.path) || parents.length >= 16) return null;
    const cached = urls.get(ref.path);
    if (cached) return cached + ref.fragment;
    const content = type === CSS || type === SVG
      ? await renderText(ref.path, [...parents, ref.path]) : await read(ref.path);
    if (destroyed) throw new Error('EPUB 已销毁');
    const url = URL.createObjectURL(new Blob([content], { type }));
    owned.add(url); urls.set(ref.path, url);
    return url + ref.fragment;
  };
  const renderText = async (path: string, parents: string[]): Promise<string> => {
    const cached = texts.get(path);
    if (cached !== undefined) return cached;
    const type = types.get(path), original = await text(path);
    let result: string;
    if (type === CSS) result = await css(original, value => resource(value, path, 'css', parents));
    else if (docs.has(type ?? '')) {
      const source = svgSpines.has(path)
        ? `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${serialize(parseEpubXml(original))}</body></html>` : original;
      result = await sanitizeDocument(source, {
        css, resource: (value, kind) => resource(value, path, kind, parents),
        navigation: value => navigation(value, path),
      });
    } else if (type === NCX) {
      const ncx = parseEpubXml(original);
      for (const content of Array.from(ncx.getElementsByTagNameNS('*', 'content'))) {
        const value = navigation(content.getAttribute('src') ?? '', path);
        if (value) content.setAttribute('src', value); else content.removeAttribute('src');
      }
      result = serialize(ncx);
    } else throw new Error(`EPUB 禁止读取未知文本资源：${path}`);
    texts.set(path, result);
    return result;
  };
  for (const path of types.keys()) await read(path);
  return {
    async loadText(path) {
      if (destroyed) throw new Error('EPUB 已销毁');
      if (texts.has(path)) return texts.get(path)!;
      if (!types.has(path)) return null;
      return renderText(path, [path]);
    },
    async loadBlob(path) {
      if (destroyed) throw new Error('EPUB 已销毁');
      const type = types.get(path);
      if (!type) return null;
      const content = docs.has(type) || type === CSS || type === NCX ? await renderText(path, [path]) : await read(path);
      return new Blob([content], { type: svgSpines.has(path) ? XHTML : type });
    },
    getSize: path => entries.get(path)?.uncompressedSize ?? 0,
    destroy() { destroyed = true; for (const url of owned) URL.revokeObjectURL(url); owned.clear(); urls.clear(); texts.clear(); bytes.clear(); },
  };
}
