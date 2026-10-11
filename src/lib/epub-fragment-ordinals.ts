import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { epubContentElements } from './epub-content-elements';
type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
/** 仅按原文元素边界记录片段所在内容块，不根据文字或标题样式推断位置。 */
export function epubFragmentOrdinals(html: string): Record<string, number> {
  const content = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const doc = parseFragment(content, { sourceCodeLocationInfo: true });
  const children = (node: HtmlNode): HtmlNode[] => 'childNodes' in node ? node.childNodes : [];
  const blocks = epubContentElements<HtmlNode>(doc.childNodes, { name: node => 'tagName' in node ? node.tagName : null, children });
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  const seen = new Set<string>(), ambiguous = new Set<string>();
  const visit = (node: HtmlNode) => {
    if ('attrs' in node && node.sourceCodeLocation) {
      const anchor = node.attrs.find(attr => attr.name === 'id' || (node.tagName === 'a' && attr.name === 'name'))?.value;
      if (anchor) {
        if (seen.has(anchor)) {
          // WHY：重复ID使应用原文锚点有歧义，但不代表整本书无法阅读；仅拒绝该锚点映射，不跳过原文或改动上游导航。
          ambiguous.add(anchor);delete result[anchor];console.warn('EPUB片段ID重复，未建立应用原文锚点',anchor);
        }
        seen.add(anchor);
        const location = node.sourceCodeLocation;
        const index = blocks.findIndex(block => {
          const other = block.sourceCodeLocation;
          return other && ((other.startOffset <= location.startOffset && other.endOffset >= location.endOffset)
            || (other.startOffset >= location.startOffset && other.endOffset <= location.endOffset));
        });
        if (index >= 0 && !ambiguous.has(anchor)) result[anchor] = index;
      }
    }
    children(node).forEach(visit);
  };
  doc.childNodes.forEach(visit);
  return result;
}
