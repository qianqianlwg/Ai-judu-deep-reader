import { EPub } from 'epub';
import type JSZip from 'jszip';

function assertSafeEntry(name: string): void {
  if (!name || /[\\:\u0000-\u001f\u007f]/u.test(name)
    || name.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('EPUB 章节资源路径不安全');
  }
}
export function resolveEpubChapterEntry(zip: JSZip, href: string): JSZip.JSZipObject {
  assertSafeEntry(href);
  // WHY：旧书可能使用字面百分号文件名，精确命中优先；仅缺失时解码一次，不能递归解码或模糊匹配同名章节。
  const literal = zip.file(href);
  if (literal) return literal;
  let decoded: string;
  try {
    decoded = href.split('/').map(segment => {
      const value = decodeURIComponent(segment);
      if (value.includes('/')) throw new Error('编码分隔符不能改变章节资源层级');
      return value;
    }).join('/');
  } catch (cause: unknown) {
    throw new Error('EPUB 章节资源 URI 编码无效', { cause });
  }
  assertSafeEntry(decoded);
  const entry = zip.file(decoded);
  if (!entry) throw new Error(`EPUB 章节资源不存在：${href}`);
  return entry;
}

/** 保留上游章节净化、清单、顺序和 href，仅修正已验证归档内的 URI 寻址。 */
export class UriAwareEpub extends EPub {
  override async getChapterRaw(id: string): Promise<string> {
    const item = this.manifest[id];
    if (!item) throw new Error('File not found');
    if (item['media-type'] !== 'application/xhtml+xml' && item['media-type'] !== 'image/svg+xml') {
      throw new Error('Invalid mime type for chapter');
    }
    return resolveEpubChapterEntry(this.zip, item.href).async('string');
  }
}
