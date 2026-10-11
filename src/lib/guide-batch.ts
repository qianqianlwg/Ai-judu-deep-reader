import type { GuideNode } from './guide';
import type { GuideSource } from './guide-sources';
import { estimateTextTokens } from './token-usage';
import { GUIDE_FRAMEWORK_TOKENS, projectGuideFramework } from './guide-context';
export type GuideBatchCapacity = { maxInputTokens: number; fixedPrompt: string; toolSchema: string; maxSources?: number };
export function guideBatchContext(nodes: readonly GuideNode[], sources: readonly GuideSource[], capacity?: GuideBatchCapacity) {
 // WHY：小窗口必须先扣除真实工具Schema、提示和查询预留，框架上限不能只乘比例后挤掉模型必需协议。
 const remaining = capacity ? capacity.maxInputTokens - estimateTextTokens(capacity.fixedPrompt + capacity.toolSchema) - 512 - guideReadReserve(capacity) - 512 : GUIDE_FRAMEWORK_TOKENS;
 const frameworkTokens = capacity ? Math.max(0, Math.min(GUIDE_FRAMEWORK_TOKENS, Math.floor(capacity.maxInputTokens * 0.35), remaining)) : GUIDE_FRAMEWORK_TOKENS;
 return { framework: projectGuideFramework(nodes, frameworkTokens), analyses: sources.map(source => ({ sourceId: source.id, analysis: source.analysisText })) };
}
export function guideReadReserve(capacity: GuideBatchCapacity) { return Math.min(2048, Math.floor(capacity.maxInputTokens * 0.2)); }
function inputTokens(context: ReturnType<typeof guideBatchContext>, capacity: GuideBatchCapacity) {
 return estimateTextTokens(capacity.fixedPrompt + JSON.stringify(context) + capacity.toolSchema) + 512 + guideReadReserve(capacity);
}
export function guideBatchInputTokens(nodes: GuideNode[], sources: readonly GuideSource[], capacity: GuideBatchCapacity): number {
 // WHY：投影、真实提示/全部工具Schema和完整分析共同计费，预留查询闭环空间；不能只给注入加预算而忽略后续工具结果。
 return inputTokens(guideBatchContext(nodes, sources, capacity), capacity);
}
export function selectGuideBatch(nodes: GuideNode[], candidates: readonly GuideSource[], capacity: GuideBatchCapacity): GuideSource[] {
  const batch: GuideSource[] = [], framework = guideBatchContext(nodes, [], capacity).framework;
  for (const source of candidates) {
    if (batch.length >= (capacity.maxSources ?? 64)) break;
    // WHY：同批候选共用同一图版本，只投影一次；避免持有SQLite写事务时每加入一则来源重扫大图。
    const analyses = [...batch, source].map(item => ({ sourceId: item.id, analysis: item.analysisText }));
    if (inputTokens({ framework, analyses }, capacity) > capacity.maxInputTokens) break;
    batch.push(source);
  }
  return batch;
}
