import type { Root, Strong, Text } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { z } from "zod";

export const answerEmphasisSchema = z.object({
  version: z.literal(1),
  marks: z.array(z.object({
    kind: z.enum(["term", "key_sentence"]),
    quote: z.string().min(1).max(1000),
    occurrence: z.number().int().min(1).max(99),
  }).strict()).max(32),
}).strict();
// WHY：有无重点由 Agent 明确决定；缺省或空数组不能代替必填的“无”。
export const answerEmphasisInputSchema = z.union([
  z.literal("无"),
  answerEmphasisSchema.extend({ marks: answerEmphasisSchema.shape.marks.min(1) }),
]).describe("必填。填写本轮正文中的精确标注；确实没有重点时填写字符串‘无’，不得省略或传空数组");
export type AnswerEmphasis = z.infer<typeof answerEmphasisSchema>;
export const EMPTY_ANSWER_EMPHASIS: AnswerEmphasis = { version: 1, marks: [] };

type Span = { start: number; end: number; kind: AnswerEmphasis["marks"][number]["kind"] };
type LocatedMark = { node: Text; span: Span; mark: AnswerEmphasis["marks"][number] };

function locate(tree: Root, marks: AnswerEmphasis["marks"]): LocatedMark[] {
  const nodes: Text[] = [];
  // WHY：只对普通段落文字着色，不碰标题、链接、代码与原文引用，避免改变可点击或可复制的语义。
  visit(tree, "text", (node, _index, parent) => { if (parent?.type === "paragraph") nodes.push(node); });
  const located: LocatedMark[] = [];
  for (const mark of marks) {
    let seen = 0;
    for (const node of nodes) {
      let offset = 0;
      while (offset < node.value.length) {
        const start = node.value.indexOf(mark.quote, offset);
        if (start < 0) break;
        seen += 1;
        if (seen === mark.occurrence) {
          const end = start + mark.quote.length;
          if (located.some(item => item.node === node && item.mark.kind === mark.kind && start < item.span.end && end > item.span.start)) break;
          located.push({ node, span: { start, end, kind: mark.kind }, mark });
          break;
        }
        offset = start + mark.quote.length;
      }
      if (seen >= mark.occurrence) break;
    }
  }
  return located;
}

export function validateAnswerEmphasis(markdown: string, proposal: unknown): AnswerEmphasis {
  const parsed = answerEmphasisSchema.safeParse(proposal);
  if (!parsed.success || !markdown.trim()) return EMPTY_ANSWER_EMPHASIS;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  let termCount = 0, sentenceCount = 0;
  const candidates = parsed.data.marks.filter(mark => {
    if (mark.kind === "term") return ++termCount <= 16;
    return ++sentenceCount <= 16;
  });
  const located = locate(tree, candidates);
  // WHY：标注必须精确命中当前正文；模型提出不存在、重叠或位于代码/链接的内容时直接丢弃，不用模糊匹配猜位置。
  return { version: 1, marks: candidates.filter(mark => located.some(item => item.mark === mark)) };
}


export function readAnswerEmphasis(markdown: string, value: unknown): AnswerEmphasis | undefined {
  if (value === undefined) return undefined;
  const parsed = answerEmphasisSchema.safeParse(value);
  if (parsed.success && parsed.data.marks.length === 0) return EMPTY_ANSWER_EMPHASIS;
  const verified = validateAnswerEmphasis(markdown, value);
  return verified.marks.length ? verified : undefined;
}

// WHY：工具时间线把同一正文分段渲染；按真实位置换算 occurrence，不能把“第二次出现”误标到另一个片段。
export function sliceAnswerEmphasis(markdown: string, emphasis: AnswerEmphasis | undefined, start: number, end = markdown.length): AnswerEmphasis | undefined {
  if (!emphasis || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > markdown.length || end <= start) return undefined;
  const verified = validateAnswerEmphasis(markdown, emphasis);
  if (start === 0 && end === markdown.length) return verified.marks.length ? verified : undefined;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const fragment = markdown.slice(start, end);
  const nodes: Text[] = [];
  visit(unified().use(remarkParse).use(remarkGfm).parse(fragment), "text", (node, _index, parent) => { if (parent?.type === "paragraph") nodes.push(node); });
  const marks: AnswerEmphasis["marks"] = [];
  for (const { node, span, mark } of locate(tree, verified.marks)) {
    const offset = node.position?.start.offset;
    // WHY：含 Markdown 转义的节点不能直接用原始偏移推测；宁可不标，也不把重点移到错误位置。
    if (offset === undefined || markdown.slice(offset, offset + node.value.length) !== node.value) continue;
    const absolute = offset + span.start;
    if (absolute < start || offset + span.end > end) continue;
    let occurrence = 0;
    for (const local of nodes) {
      for (let from = 0; from < local.value.length;) {
        const found = local.value.indexOf(mark.quote, from);
        if (found < 0) break;
        occurrence++;
        const localOffset = local.position?.start.offset;
        if (localOffset !== undefined && fragment.slice(localOffset, localOffset + local.value.length) === local.value && start + localOffset + found === absolute) marks.push({ ...mark, occurrence });
        from = found + mark.quote.length;
      }
    }
  }
  const result = validateAnswerEmphasis(fragment, { version: 1, marks });
  return result.marks.length ? result : undefined;
}

export function remarkAnswerEmphasis(emphasis: AnswerEmphasis) {
  return (tree: Root): void => {
    const placements = locate(tree, emphasis.marks);
    const grouped = new Map<Text, Span[]>();
    for (const { node, span } of placements) grouped.set(node, [...(grouped.get(node) ?? []), span]);
    visit(tree, "text", (node, index, parent) => {
      if (parent?.type !== "paragraph" || index === undefined) return;
      const spans = grouped.get(node)?.sort((a, b) => a.start - b.start);
      if (!spans?.length) return;
      const children: (Text | Strong)[] = [];
      // WHY：不同类别允许叠加；按已核验范围边界切分展示，绝不复制原文或扩大重点。
      const boundaries = [...new Set([0, node.value.length, ...spans.flatMap(span => [span.start, span.end])])].sort((left, right) => left - right);
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i], end = boundaries[i + 1];
        const kinds = [...new Set(spans.filter(span => span.start <= start && span.end >= end).map(span => span.kind))];
        let child: Text | Strong = { type: 'text', value: node.value.slice(start, end) };
        for (const kind of kinds) child = { type: 'strong', data: { hName: 'span', hProperties: { 'data-answer-emphasis': kind } }, children: [child] };
        children.push(child);
      }
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}
