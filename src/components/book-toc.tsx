"use client";
import type { BookNavigationItem } from '@/lib/book-navigation';
type Props = { items: readonly BookNavigationItem[]; currentChapterId?: string; activeId?: string; onOpen(item: BookNavigationItem): void };
export function BookToc({items,currentChapterId,activeId,onOpen}:Props) {
  const firstMatch = (items:readonly BookNavigationItem[]):string|undefined => {
    for(const item of items){if(item.chapterId===currentChapterId && currentChapterId)return item.id;const child=firstMatch(item.children);if(child)return child;}
    return undefined;
  };
  const selected = activeId ?? firstMatch(items);
  const tree = (items:readonly BookNavigationItem[],depth=0) => <ol className="book-toc-tree" data-depth={depth}>{items.map(item => <li key={item.id}>
    <button type="button" className={'toc-item'+(item.id===selected?' active':'')} aria-current={item.id===selected?'location':undefined}
      title={item.label} disabled={!item.href&&!item.paragraphId} onClick={()=>onOpen(item)}><span>{item.label}</span></button>
    {item.children.length>0&&tree(item.children,depth+1)}
  </li>)}</ol>;
  return <nav aria-label="本书目录">{tree(items)}</nav>;
}
