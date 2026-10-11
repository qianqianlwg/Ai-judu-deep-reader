import { z } from 'zod';
import { anchorParts, makeReadingAnchor, readReadingAnchor, splitsReadingCharacter, type ReadingAnchorPart } from './reading-anchors';
import { answerEmphasisProtocolSchema, resolveAnswerEmphasis } from './answer-emphasis-protocol';
import { resolveSourceEmphasis, type SourceEmphasis } from './source-enhancement';
import type { SemanticUnit } from './semantic-reading';

const paragraphKey = z.string().regex(/^p[A-Za-z0-9]{5,8}$/u, '必须使用本轮提供的6至9字符段落短标识');
const sourceMark = z.object({ paragraphKey, quote: z.string().min(1).max(1000) }).strict();
const sourceConcept = z.object({ paragraphKey, name: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(2000) }).strict();
const sourceMarkList = z.union([z.literal('none'), z.array(sourceMark).min(1).max(16)]);
const conceptList = z.union([z.literal('none'), z.array(sourceConcept).min(1).max(20)]);
export const semanticSubmissionSchema = z.object({
  sourceStart: z.string().min(1).refine(value => Array.from(value).length <= 8, '原文首最多8个字符')
    .describe('当前句原文开头5至8个字符，保留标点和空白；不足5字的短句使用全文'),
  // WHY：默认尾部5至8字；遇到歧义必须允许Agent补交更长逐字尾部，不能一边要求加长一边限制8字。
  sourceEnd: z.string().min(1).refine(value => Array.from(value).length <= 160, '原文尾最多160个字符')
    .describe('通常提交当前句原文结尾5至8个字符；不足5字的短句使用全文。匹配不唯一时补交更长的逐字尾部，最多160字'),
  title: z.string().trim().min(1).max(120).describe('当前句的小标题，不需要整组标题'),
  content: z.string().trim().min(1).describe('当前句的完整句读解释正文，Markdown；不是定位用的原文，不输出思考详情'),
  sourceAnnotations: z.object({
    keywords: sourceMarkList.describe('必填：原文关键词，每项paragraphKey和逐字quote；没有填字符串none，不能省略或空数组'),
    keySentences: sourceMarkList.describe('必填：原文关键句，每项paragraphKey和逐字quote；没有填字符串none，不能省略或空数组'),
    concepts: conceptList.describe('必填：原文概念，每项paragraphKey、逐字name及解释text；没有填字符串none，不能省略或空数组'),
  }).strict().describe('每项只属于当前句实际覆盖的原文段落。短标识来自target，重复引文只标注本句在该段的第一次匹配'),
  answerEmphasis: answerEmphasisProtocolSchema.describe('必填 keywords 和 keySentences，各最多16项、每项最多1000字符；没有分别填 none。引用解释正文，不提交 marks/kind/version/occurrence。'),
}).strict();
export type SemanticSubmission = z.infer<typeof semanticSubmissionSchema>;
export type SemanticSubmissionSource = ReadingAnchorPart & { paragraphKey: string };

export function semanticSourceViews(sources: readonly ReadingAnchorPart[]): SemanticSubmissionSource[] {
  const keys = new Map<string, string>();
  return sources.map(source => {
    // WHY：别名只在本轮来源内使用；按首次出现的段落顺序分配，稳定、无碰撞，数据库UUID不改变。
    if (!keys.has(source.paragraphId)) keys.set(source.paragraphId, 'p' + String(keys.size + 1).padStart(6, '0'));
    return { ...source, paragraphKey: keys.get(source.paragraphId)! };
  });
}
function issuePath(path: readonly PropertyKey[]): string {
  return path.map(part => typeof part === 'number' ? '[' + part + ']' : String(part)).join('.').replaceAll('.[', '[') || '工具字段';
}
function issueDescriptions(issue: z.core.$ZodIssue, prefix: readonly PropertyKey[] = []): string[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === 'invalid_union') {
    // WHY：排除none分支的一般错误，优先展示数组/对象分支的具体子字段，反馈不能把真实错误抹成“所有字段必填”。
    const branches = issue.errors.filter(branch => branch.some(child => child.code !== 'invalid_value'));
    return (branches.length ? branches[0] : issue.errors[0]).flatMap(child => issueDescriptions(child, path));
  }
  let message = issue.message;
  if (issue.code === 'invalid_type') message = '字段必填且类型应为' + issue.expected + '；无标注字段请明确填写none，不能省略';
  else if (issue.code === 'unrecognized_keys') message = '不支持字段：' + issue.keys.join('、') + '；请按当前工具结构提交';
  else if (issue.code === 'too_small') message = '不能填写空内容或空数组；无标注字段请明确填写none';
  return [issuePath(path) + '：' + message];
}
export function formatSemanticSubmissionError(error: unknown): string {
  if (!(error instanceof z.ZodError)) return error instanceof Error ? error.message : String(error);
  return error.issues.flatMap(issue => issueDescriptions(issue)).join('；');
}
export function sourceLength(sources: readonly ReadingAnchorPart[]): number { return sources.reduce((n, p) => n + Array.from(p.selectedText).length, 0); }
export function coveredOffset(units: readonly SemanticUnit[], sources: readonly ReadingAnchorPart[]): number {
  let offset = 0;
  const original = sources.map(p => p.selectedText).join('');
  for (const unit of units) {
    if (!readReadingAnchor(unit.anchor)) throw new Error('已保留句读的来源或位置不正确');
    const text = anchorParts(unit.anchor).map(p => p.selectedText).join('');
    if (!original.startsWith(text, offset)) throw new Error('已保留句读与当前原文不连续，不能继续');
    let at = offset, consumed = 0;
    for (const source of sources) {
      const next = consumed + source.selectedText.length;
      if (offset < next && offset + text.length > consumed) {
        const part = anchorParts(unit.anchor).find(p => p.paragraphId === source.paragraphId && p.startOffset === source.startOffset + Math.max(0, at - consumed));
        const expected = source.selectedText.slice(Math.max(0, at - consumed), Math.min(source.selectedText.length, offset + text.length - consumed));
        if (!part || part.selectedText !== expected || part.endOffset !== part.startOffset + expected.length) throw new Error('已保留句读的来源或位置不正确');
        at += expected.length;
      }
      consumed = next;
    }
    offset += text.length;
  }
  return offset;
}
function locateSentence(input: SemanticSubmission, original: string, offset: number): number {
  if (offset < 0 || !Number.isSafeInteger(offset) || offset >= original.length || !original.startsWith(input.sourceStart, offset))
    throw new Error('sourceStart：找不到对应语句的原文首，请准确反映当前未处理原文开头后重试');
  const shortLocator = input.sourceStart === input.sourceEnd && Array.from(input.sourceStart).length < 5;
  if (shortLocator) {
    // WHY: A short sentence is submitted in full; identical short tails later in the source must not create ambiguity.
    const end = offset + input.sourceStart.length;
    if (original.slice(offset, end) !== input.sourceStart) {
      throw new Error('sourceEnd????????????????????????');
    }
    const text = original.slice(offset, end);
    if (!text.trim()) throw new Error('sourceStart/sourceEnd??????????????????');
    return end;
  }
  const candidates: number[] = [];
  // WHY: Count every tail match in the unprocessed source, including overlapping matches; never silently choose the first one.
  for (let index = original.indexOf(input.sourceEnd, offset); index >= 0; index = original.indexOf(input.sourceEnd, index + 1)) {
    const end = index + input.sourceEnd.length;
    if (end >= offset + input.sourceStart.length) candidates.push(end);
  }
  if (!candidates.length) throw new Error('sourceEnd：找不到对应语句的原文尾，请准确反映原文尾部后重试');
  if (candidates.length > 1) throw new Error('sourceEnd：原文尾部匹配不唯一，请提供更长的逐字原文尾部（可超过8字）后重试');
  const end = candidates[0], text = original.slice(offset, end), count = Array.from(text).length;
  for (const field of ['sourceStart', 'sourceEnd'] as const) {
    const value = input[field], size = Array.from(value).length;
    if (count < 5 ? value !== text : size < 5) throw new Error(field + '：需要提供5至8个字符，不足5字的短句必须使用全文');
  }
  if (!text.trim()) throw new Error('sourceStart/sourceEnd：不能把纯空白作为一句，请并入相邻原文');
  if (original.slice(end).length && !original.slice(end).trim()) throw new Error('sourceEnd：原文末尾还有空白，请将空白并入本句并提交完整逐字尾部');
  return end;
}
function sentenceParts(sources: readonly ReadingAnchorPart[], offset: number, end: number): ReadingAnchorPart[] {
  const parts: ReadingAnchorPart[] = []; let consumed = 0;
  for (const source of sources) {
    const from = Math.max(0, offset - consumed), to = Math.min(source.selectedText.length, end - consumed);
    if (to > from) {
      const boundaries = new Set([source.selectedText.length, ...Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(source.selectedText), p => p.index)]);
      if (!boundaries.has(from) || !boundaries.has(to) || splitsReadingCharacter(source.selectedText, from) || splitsReadingCharacter(source.selectedText, to)) throw new Error('sourceStart/sourceEnd：原文边界不能拆开Unicode字符，请修正');
      parts.push({ paragraphId: source.paragraphId, startOffset: source.startOffset + from, endOffset: source.startOffset + to, selectedText: source.selectedText.slice(from, to) });
    }
    consumed += source.selectedText.length;
  }
  if (parts.some(p => !p.selectedText.trim())) throw new Error('sourceStart/sourceEnd：不能创建纯空白来源片段，请并入相邻原文');
  return parts;
}
function annotationPart(key: string, path: string, sources: readonly SemanticSubmissionSource[], parts: readonly ReadingAnchorPart[]): ReadingAnchorPart {
  const source = sources.find(item => item.paragraphKey === key);
  if (!source) throw new Error(path + '.paragraphKey：不是本次原文来源，请使用target提供的短标识');
  const part = parts.find(item => item.paragraphId === source.paragraphId);
  if (!part) throw new Error(path + '.paragraphKey：对应段落不在当前句的原文范围内');
  return part;
}
function sourceMarks(input: SemanticSubmission, sources: readonly SemanticSubmissionSource[], parts: readonly ReadingAnchorPart[]): SourceEmphasis[] {
  const marks: SourceEmphasis[] = [];
  for (const field of ['keywords', 'keySentences'] as const) {
    const proposals = input.sourceAnnotations[field]; if (proposals === 'none') continue;
    for (const [index, proposal] of proposals.entries()) {
      const path = 'sourceAnnotations.' + field + '[' + index + ']';
      const part = annotationPart(proposal.paragraphKey, path, sources, parts);
      // WHY：保留旧存储的已验证偏移格式；类型从字段名确定，第一次匹配是用户指定的定位规则，不由Agent提供序号。
      const kind = field === 'keywords' ? 'term' : 'key_sentence';
      const resolved = resolveSourceEmphasis([{ paragraphId: part.paragraphId, kind, quote: proposal.quote, occurrence: 1 }], [part])[0];
      if (!resolved) throw new Error(path + '.quote：未逐字匹配当前句对应原文，不做模糊匹配；没有重点填none');
      if (marks.some(mark => mark.paragraphId === resolved.paragraphId && mark.kind === kind && mark.startOffset < resolved.endOffset && mark.endOffset > resolved.startOffset)) throw new Error(path + '.quote：与同类已提交标注重复或重叠，请修正');
      marks.push(resolved);
    }
  }
  return marks;
}
export function resolveSemanticSubmission(value: unknown, sources: readonly SemanticSubmissionSource[], offset: number, makeId: () => string): { unit: SemanticUnit; end: number } {
  const input = semanticSubmissionSchema.parse(value), original = sources.map(p => p.selectedText).join('');
  const end = locateSentence(input, original, offset), parts = sentenceParts(sources, offset, end);
  const sourceEmphasis = sourceMarks(input, sources, parts);
  const sourceConcepts = input.sourceAnnotations.concepts === 'none' ? [] : input.sourceAnnotations.concepts.map((item, index) => {
    const path = 'sourceAnnotations.concepts[' + index + ']';
    const part = annotationPart(item.paragraphKey, path, sources, parts);
    if (!part.selectedText.includes(item.name)) throw new Error(path + '.name：概念名称未逐字出现在当前句对应原文，不允许引用本段其他位置');
    return { paragraphId: part.paragraphId, name: item.name, text: item.text };
  });
  // WHY：摘要直接保存Agent的解释，内部协议转换不生成概念或重点，所有内容都来自必填工具字段。
  const unit: SemanticUnit = { id: makeId(), label: input.title, action: 'read', reason: '', anchor: makeReadingAnchor(parts), status: 'completed', content: input.content, sourceEmphasis,
    analysis: { summary: input.content, readingText: input.content, provenanceVersion: 1, breakdown: [], concepts: sourceConcepts.map(({ name, text }) => ({ name, text })), context: '', uncertainty: '', emphasisSource: 'agent', emphasis: resolveAnswerEmphasis(input.content, input.answerEmphasis) } };
  return { unit, end };
}
