import { randomUUID } from 'node:crypto';
import { tool } from 'langchain';
import { semanticSubmissionSchema, resolveSemanticSubmission, coveredOffset, sourceLength, formatSemanticSubmissionError, semanticSourceViews, type SemanticSubmission } from '../semantic-submission';
import { semanticSummary, type SemanticReading, type SemanticSource, type SemanticUnit, type ReadingStyle } from '../semantic-reading';
import { SemanticPlanError } from '../semantic-plan-input';
import { TOOL_NAMES } from './tool-choice';

export const SENTENCE_TOOL = TOOL_NAMES.submitReadingSentence;
export const SENTENCE_EXAMPLE: SemanticSubmission = {
  sourceStart: '劳动形成价', sourceEnd: '劳动形成价值。', title: '劳动与价值', content: '劳动形成商品的价值。',
  sourceAnnotations: { keywords: [{ paragraphKey: 'p000001', quote: '劳动' }], keySentences: 'none', concepts: 'none' },
  answerEmphasis: { keywords: ['劳动'], keySentences: 'none' },
};
export const SENTENCE_DESCRIPTION = '按原文顺序提交当前一句（whole模式为当前自然段）的完整释读与标注，不规划整份结果，不跳过、不重复。sourceStart通常为首5至8字符，sourceEnd通常为尾5至8字符，保留原文空白标点；不足5字用全文，尾部匹配不唯一时加长尾部，最多160字符。content是释读解释正文，不是定位原文。所有字段必填，无重点分别填none；原文标注每项用本轮paragraphKey。正文和原文的keywords/keySentences各最多16项，每项最多1000字符，concepts最多20项。一次只调用此工具一次，失败按具体字段/位置修正当前句。示例（target原文为“劳动形成价值。”，paragraphKey=p000001）：' + JSON.stringify(SENTENCE_EXAMPLE);
export type SemanticSessionOptions = {
  sources: SemanticSource[]; readingStyle?: ReadingStyle; previous?: SemanticReading;
  publish: (state: SemanticReading, content: string) => void;
  commit: (unit: SemanticUnit, state: SemanticReading) => void;
};
export function createSemanticSession(options: SemanticSessionOptions) {
  const original = options.sources.map(source => source.selectedText).join('');
  const views = semanticSourceViews(options.sources);
  const units: SemanticUnit[] = [];
  for (const unit of options.previous?.units ?? []) {
    if (unit.status !== 'completed' && unit.status !== 'skipped') break;
    units.push(structuredClone(unit));
  }
  let offset = coveredOffset(units, options.sources), failures = 0;
  const state: SemanticReading = { version: 1, readingStyle: options.readingStyle ?? 'semantic', totalCharacters: sourceLength(options.sources), thinkingCompleted: units.length > 0, phase: units.length ? 'reading' : 'planning', units };
  const publish = () => options.publish(structuredClone(state), semanticSummary(state));
  const remaining = () => ({ completed: state.units.length, nextSourceStart: Array.from(original.slice(offset)).slice(0, 8).join(''), remainingCharacters: Array.from(original.slice(offset)).length, allCovered: offset === original.length });
  const fail = (error: unknown) => {
    const message = formatSemanticSubmissionError(error);
    state.thinkingCompleted = true; state.phase = 'reading';
    state.pending = { index: state.units.length + 1, error: message }; publish();
    if (++failures >= 3) throw new SemanticPlanError('当前句三次未通过核验，已完成内容保留。' + message);
    return { ok: false, code: 'sentence_invalid', error: message, ...remaining() };
  };
  const submit = tool(async input => {
    let result: ReturnType<typeof resolveSemanticSubmission>;
    try { result = resolveSemanticSubmission(input, views, offset, randomUUID); }
    catch (error: unknown) { return fail(error); }
    const next: SemanticReading = { ...state, thinkingCompleted: true, phase: 'reading', pending: undefined, units: [...state.units, result.unit] };
    // WHY：只有来源、标注和数据库事务全部成功，才发布正式句读；不能把持久化异常当成参数错误重试。
    options.commit(result.unit, structuredClone(next));
    Object.assign(state, next); offset = result.end; failures = 0; publish();
    return { ok: true, unitId: result.unit.id, ...remaining(), instruction: offset === original.length ? '原文已全部句读。保持当前对话上下文，直接输出简明综合小结，不再调用工具。' : '继续处理nextSourceStart起始的下一句，不重复已完成句读。' };
  }, { name: SENTENCE_TOOL, description: SENTENCE_DESCRIPTION, schema: semanticSubmissionSchema });
  publish();
  return {
    tool: submit, get complete() { return offset === original.length; }, get state() { return structuredClone(state); },
    // WHY：原文字符数仅用于保证循环能覆盖一字短句，不按累积Token取消任务；每句仍保留三次纠错保护。
    recursionLimit: Math.max(100, sourceLength(options.sources) * 8 + 100),
    sourceData: { readingStyle: state.readingStyle, target: views.map(({ startOffset, endOffset, selectedText, paragraphKey }) => ({ paragraphKey, startOffset, endOffset, selectedText })), alreadyCompleted: state.units.map(unit => ({ title: unit.label, content: unit.content, anchor: unit.anchor })), ...remaining() },
    startSentence() { if (!state.thinkingCompleted || (!state.pending && !this.complete)) { state.thinkingCompleted = true; state.phase = 'reading'; state.pending = { index: state.units.length + 1 }; publish(); } },
    invalidArguments: fail,
    startConclusion() { state.pending = undefined; state.conclusion = { status: 'streaming', content: '' }; publish(); },
    conclusion(content: string) { state.conclusion = { status: 'streaming', content }; publish(); },
    finish() { state.phase = 'completed'; if (state.conclusion) state.conclusion.status = 'completed'; publish(); },
    interrupt(message: string) { state.phase = 'interrupted'; if (state.conclusion?.status === 'streaming') state.conclusion = { ...state.conclusion, status: 'error', error: message }; publish(); },
  };
}
export type SemanticSession = ReturnType<typeof createSemanticSession>;
