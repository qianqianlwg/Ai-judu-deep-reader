// WHY：仅由浏览器句子分段取得避让区域，不生成或改写 Agent 的内容、概念、句读分块和标注。
export function rangeAroundReaderSentence(target: Range): Range {
  const doc = target.startContainer.ownerDocument;
  const parent = target.startContainer.nodeType === 1 ? target.startContainer as Element : target.startContainer.parentElement;
  const block = parent?.closest('[data-paragraph-id],p,li,h1,h2,h3,h4,h5,h6,blockquote') ?? parent;
  if (!doc || !block?.contains(target.endContainer)) return target.cloneRange();
  const walker = doc.createTreeWalker(block, 4), nodes: { node: Node; start: number; end: number }[] = [];
  let text = '', start: number | undefined, end: number | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-reader-decoration],[data-judu-decoration],script,style')) continue;
    const offset = text.length, value = node.nodeValue ?? '';
    if (target.intersectsNode(node)) {
      const low = node === target.startContainer ? target.startOffset : 0;
      const high = node === target.endContainer ? target.endOffset : value.length;
      if (high > low) { start ??= offset + low; end = offset + high; }
    }
    nodes.push({ node, start: offset, end: offset + value.length }); text += value;
  }
  if (start === undefined || end === undefined) return target.cloneRange();
  const segments = [...new Intl.Segmenter('zh-CN', { granularity: 'sentence' }).segment(text)];
  const first = segments.find(s => s.index <= start! && start! < s.index+s.segment.length);
  const last = segments.find(s => s.index < end! && end! <= s.index+s.segment.length);
  if (!first || !last) return target.cloneRange();
  const low = first.index, high = last.index+last.segment.length;
  const firstNode = nodes.find(n => n.start <= low && low < n.end), lastNode = nodes.find(n => n.start < high && high <= n.end);
  if (!firstNode || !lastNode) return target.cloneRange();
  const range = doc.createRange(); range.setStart(firstNode.node,low-firstNode.start); range.setEnd(lastNode.node,high-lastNode.start); return range;
}

export function sentenceRectsForElement(element: HTMLElement): DOMRect[] {
  const target = element.ownerDocument.createRange(); target.selectNodeContents(element);
  const range = rangeAroundReaderSentence(target);
  return typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0) : [element.getBoundingClientRect()];
}
