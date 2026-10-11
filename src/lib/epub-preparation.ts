import type { FoliateBook } from './foliate-types';

export type EpubPreparationPosition = { initialHref?: string; initialCfi?: string };

export function nearbyEpubSections(length: number, center: number, count = 10): number[] {
  const target = Math.max(0, Math.min(length - 1, center));
  const indices: number[] = [];
  for (let distance = 0; indices.length < Math.min(count, length); distance++) {
    if (target + distance < length) indices.push(target + distance);
    if (distance && target - distance >= 0 && indices.length < count) indices.push(target - distance);
  }
  return indices;
}

export function initialEpubSection(book: FoliateBook, position: EpubPreparationPosition): number {
  const valid = (index: number | undefined): index is number => index !== undefined && Number.isInteger(index) && index >= 0 && index < book.sections.length;
  if (position.initialCfi) {
    try { const index = book.resolveCFI?.(position.initialCfi).index; if (valid(index)) return index; }
    catch (cause: unknown) { console.warn('预热原版位置已失效，改用章节锚点', cause); }
  }
  if (position.initialHref) {
    try { const index = book.resolveHref?.(position.initialHref)?.index; if (valid(index)) return index; }
    catch (cause: unknown) { console.warn('预热章节锚点已失效，改用首章', cause); }
  }
  const first = book.sections.findIndex(section => section.linear !== 'no');
  return first < 0 ? 0 : first;
}

export async function prepareEpubSections(book: FoliateBook, indices: readonly number[], signal?: AbortSignal): Promise<void> {
  for (const index of indices) {
    signal?.throwIfAborted();
    await book.sections[index].createDocument();
    signal?.throwIfAborted();
  }
}

export async function prepareRemainingEpubSections(book: FoliateBook, prepared: ReadonlySet<number>, signal: AbortSignal): Promise<void> {
  for (let index = 0; index < book.sections.length; index++) {
    if (prepared.has(index)) continue;
    // WHY：后台净化在章节之间让出主线程，不能用连续微任务挤占翻页、输入和首次绘制。
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    signal.throwIfAborted();
    await book.sections[index].createDocument();
  }
}
