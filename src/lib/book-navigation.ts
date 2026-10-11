import type { LibraryChapter } from './library';
import type { ParsedNavigationItem } from './foliate-import';
export type BookNavigationItem = { id: string; label: string; href?: string; chapterId?: string; paragraphId?: string; children: BookNavigationItem[] };
export function epubResourceKey(href: string): string {
  return decodeURI(href.split('#', 1)[0]).replace(/^\.\//u, '');
}
export function bookNavigation(items: readonly ParsedNavigationItem[], chapters: readonly LibraryChapter[], sources: readonly {sourceHref:string;fragmentOrdinals?:Record<string,number>}[]): BookNavigationItem[] {
  const byResource = new Map(chapters.filter(c => c.sourceHref).map(c => [epubResourceKey(c.sourceHref!), c]));
  const parsedResources = new Map(sources.map(c => [epubResourceKey(c.sourceHref), c]));
  const convert = (items: readonly ParsedNavigationItem[], prefix = ''): BookNavigationItem[] => items.flatMap((item, index) => {
    const id = 'toc:' + prefix + index, children = convert(item.children, prefix + index + '/');
    if (!item.label.trim()) return children;
    const href=item.href&&!/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(item.href)?item.href:undefined;
    const key = href ? epubResourceKey(href) : undefined;
    const chapter = key ? byResource.get(key) : undefined;
    const source = key ? parsedResources.get(key) : undefined;
    const fragment = href?.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : undefined;
    const ordinal = fragment ? source?.fragmentOrdinals?.[fragment] : undefined;
    // WHY：书内目录与阅读分片独立；同一分片的多个章内目录项保留，不因ChapterID相同而去重或造标题。
    const paragraph = fragment ? chapter?.paragraphs.find(p => p.sourceOrdinal === ordinal && ordinal !== undefined) : chapter?.paragraphs[0];
    return [{ id, label: item.label, ...(href ? { href } : {}), ...(chapter ? { chapterId: chapter.id } : {}), ...(paragraph ? { paragraphId: paragraph.id } : {}), children }];
  });
  return convert(items);
}
export function readBookNavigation(value: unknown): BookNavigationItem[] {
  let count = 0;
  const read = (value: unknown, depth: number): BookNavigationItem[] => {
    if (!Array.isArray(value) || depth > 32) throw new Error('书内目录数据无效');
    return value.map((item: unknown) => {
      if (++count > 5000 || !item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string'
        || !('label' in item) || typeof item.label !== 'string' || !item.label.trim() || !('children' in item)) throw new Error('书内目录项无效');
      const optional = (key: 'href' | 'chapterId' | 'paragraphId'): string | undefined => {
        if (!(key in item)) return undefined;
        const field: unknown = Reflect.get(item, key);
        if (typeof field !== 'string' || !field) throw new Error('书内目录定位无效');
        return field;
      };
      const href = optional('href'), chapterId = optional('chapterId'), paragraphId = optional('paragraphId');
      if(href)decodeURI(href);
      if (href && /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(href)) throw new Error('书内目录不允许外部地址');
      return { id: item.id, label: item.label, ...(href ? { href } : {}), ...(chapterId ? { chapterId } : {}), ...(paragraphId ? { paragraphId } : {}), children: read(item.children, depth + 1) };
    });
  };
  const items = read(value, 0), ids = new Set<string>();
  const check = (items: BookNavigationItem[]) => items.forEach(item => { if (ids.has(item.id)) throw new Error('书内目录ID重复'); ids.add(item.id); check(item.children); });
  check(items); return items;
}

export function findBookNavigationByHref(items:readonly BookNavigationItem[],href:string):BookNavigationItem|undefined {
  const target=decodeURI(href);
  for(const item of items){if(item.href&&decodeURI(item.href)===target)return item;const child=findBookNavigationByHref(item.children,href);if(child)return child;}
  return undefined;
}
