import { selectionMatchesParagraphs, type ReadingSelection } from './reader-selection';
import type { LibraryParagraph } from './library';
import {isSupplementalEpubBlock} from './source-block';
/** 仅用于已持久化历史的来源展示；新选区、合并与服务端请求仍必须覆盖全部内容块。 */
export function savedSelectionMatchesSource(selection: ReadingSelection, paragraphs: readonly LibraryParagraph[]): boolean {
    if (selectionMatchesParagraphs(selection, paragraphs))
        return true;
    // WHY：旧记录生成时标题未进入来源序列，不能把新增标题拼入旧引文或改变旧偏移；依据已保留的旧 ID 命名空间只核验旧正文投影，不放宽新句读请求协议。
    if (!paragraphs.some(p => p.kind === 'heading'||isSupplementalEpubBlock(p.id)))
        return false;
    return selectionMatchesParagraphs(selection, paragraphs.filter(p => p.kind !== 'heading'&&!isSupplementalEpubBlock(p.id)));
}
