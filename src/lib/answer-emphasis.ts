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
    quote: z.string().trim().min(2).max(160),
    occurrence: z.number().int().min(1).max(99),
  }).strict()).max(4),
}).strict();
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
          if (located.some(item => item.node === node && start < item.span.end && end > item.span.start)) break;
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

function validLength(mark: AnswerEmphasis["marks"][number]): boolean {
  const length = Array.from(mark.quote).length;
  return mark.kind === "term" ? length <= 16 && !/[\r\n]/u.test(mark.quote) : length >= 8 && !/[\r\n]/u.test(mark.quote);
}

export function validateAnswerEmphasis(markdown: string, proposal: unknown): AnswerEmphasis {
  const parsed = answerEmphasisSchema.safeParse(proposal);
  if (!parsed.success || !markdown.trim()) return EMPTY_ANSWER_EMPHASIS;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  let termCount = 0, sentenceCount = 0;
  const candidates = parsed.data.marks.filter(mark => {
    if (!validLength(mark)) return false;
    if (mark.kind === "term") return ++termCount <= 3;
    return ++sentenceCount <= 1;
  });
  const located = locate(tree, candidates);
  // WHY：标注必须精确命中当前正文；模型提出不存在、重叠或位于代码/链接的内容时直接丢弃，不用模糊匹配猜位置。
  return { version: 1, marks: candidates.filter(mark => located.some(item => item.mark === mark)) };
}


function paragraphTextNodes(tree: Root): Text[] {
  const nodes: Text[] = [];
  visit(tree, "text", (node, _index, parent) => { if (parent?.type === "paragraph") nodes.push(node); });
  return nodes;
}

function sentenceCandidates(nodes: Text[]): Array<{ quote: string; node: Text }> {
  const candidates: Array<{ quote: string; node: Text }> = [];
  for (const node of nodes) {
    for (const match of node.value.matchAll(/[^。！？!?；;\n]{8,160}[。！？!?；;]/gu)) {
      const quote = match[0].trim();
      if (quote.length >= 8 && quote.length <= 160) candidates.push({ quote, node });
    }
    const fallback = node.value.trim();
    if (!/[。！？!?；;]$/u.test(fallback) && Array.from(fallback).length >= 8 && Array.from(fallback).length <= 160) {
      candidates.push({ quote: fallback, node });
    }
  }
  return candidates;
}

function sentenceScore(quote: string): number {
  const cjk = (quote.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const length = Array.from(quote).length;
  // WHY：服务端兜底只挑一条自然完整的句子，不把整段正文涂满；适度偏向包含解释信息的中文句子。
  return cjk * 3 + Math.min(length, 72) + (/[，、]/u.test(quote) ? 8 : 0) - (length > 120 ? 24 : 0);
}

function inferredTerms(nodes: Text[], keySentence: string): string[] {
  const commonPrefix = /^(?:而且|但是|所以|因此|如果|因为|由于|通过|可以|能够|应当|应该|先看|再看|再确定|需要|这是|这就|主要是|也就是)/u;
  const commonSuffix = /(?:的是|就是|起来|方面)$/u;
  const candidates = new Map<string, number>();
  for (const node of nodes) {
    for (const raw of node.value.split(/[，,、；;：:。！？!?\n]/u)) {
      let phrase = raw.trim().replace(commonPrefix, "").replace(commonSuffix, "");
      if (phrase.length < 2 || phrase.length > 16 || keySentence.includes(phrase)) continue;
      if (!/[\u3400-\u9fff]/u.test(phrase)) continue;
      phrase = phrase.replace(/^[的了着过在与和及或把被对从向为于]+/u, "").replace(/[的了着过在与和及或把被对从向为于]+$/u, "");
      if (Array.from(phrase).length < 2) continue;
      candidates.set(phrase, (candidates.get(phrase) ?? 0) + 1);
    }
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || Array.from(b[0]).length - Array.from(a[0]).length)
    .slice(0, 2)
    .map(([quote]) => quote);
}

export function inferAnswerEmphasis(markdown: string): AnswerEmphasis | undefined {
  if (!markdown.trim()) return undefined;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const nodes = paragraphTextNodes(tree);
  const sentences = sentenceCandidates(nodes).sort((a, b) => sentenceScore(b.quote) - sentenceScore(a.quote));
  const key = sentences[0];
  if (!key) return undefined;
  const terms = inferredTerms(nodes, key.quote).map((quote) => ({ kind: "term" as const, quote, occurrence: 1 }));
  const verified = validateAnswerEmphasis(markdown, { version: 1, marks: [
    ...terms,
    { kind: "key_sentence" as const, quote: key.quote, occurrence: 1 },
  ] });
  return verified.marks.length ? verified : undefined;
}

export function readAnswerEmphasis(markdown: string, value: unknown): AnswerEmphasis | undefined {
  if (value === undefined) return undefined;
  const verified = validateAnswerEmphasis(markdown, value);
  return verified.marks.length ? verified : undefined;
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
      let at = 0;
      for (const span of spans) {
        if (span.start > at) children.push({ type: "text", value: node.value.slice(at, span.start) });
        children.push({ type: "strong", data: { hName: "span", hProperties: { "data-answer-emphasis": span.kind } }, children: [{ type: "text", value: node.value.slice(span.start, span.end) }] });
        at = span.end;
      }
      if (at < node.value.length) children.push({ type: "text", value: node.value.slice(at) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}
