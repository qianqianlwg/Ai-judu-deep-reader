import { z } from "zod";
import { guideDescendants, type GuideNode } from "./guide";
const identity = z.string().min(1);
export const guideLocationSpanSchema = z.object({
  paragraphId: identity, chapterId: identity, chapterTitle: z.string(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  start: z.number().finite().min(0).max(1), end: z.number().finite().min(0).max(1),
}).strict().refine(span => span.end > span.start, "原文位置区段必须有长度");
export const guideSourceLocationSchema = z.object({
  sourceId: identity, editionId: identity, editionLabel: z.string(),
  spans: z.array(guideLocationSpanSchema).min(1),
}).strict();
export const guideLocationsSchema = z.object({
  bookId: identity, version: z.number().int().nonnegative(),
  sources: z.array(guideSourceLocationSchema), issues: z.array(z.string()),
}).strict();
export type GuideLocationSpan = z.infer<typeof guideLocationSpanSchema>;
export type GuideSourceLocation = z.infer<typeof guideSourceLocationSchema>;
export type GuideLocations = z.infer<typeof guideLocationsSchema>;
export type GuideNodePosition = { sources: GuideSourceLocation[]; inherited: boolean; missing: number };
// WHY：位置是已提交原文来源的显示元数据；不依据主题标题、生成时间或关键词补造来源。
export function guideNodePosition(node: GuideNode, nodes: readonly GuideNode[], locations: GuideLocations): GuideNodePosition {
  const inherited = node.sourceIds.length === 0;
  const descendants = inherited ? guideDescendants(nodes, node.id) : new Set([node.id]);
  const ids = new Set(nodes.filter(item => descendants.has(item.id)).flatMap(item => item.sourceIds));
  const sources = locations.sources.filter(source => ids.has(source.sourceId));
  const available = new Set(sources.map(source => source.sourceId));
  return { sources, inherited: inherited && sources.length > 0, missing: [...ids].filter(id => !available.has(id)).length };
}
// WHY：增加可区分的主色与鲜明度，图例和导图连线仍共用同一连续位置色阶，不为主题新增含义。
export const GUIDE_POSITION_STOPS = ["#3b6bd6", "#159ec2", "#18a59b", "#67b44e", "#d0b83c", "#e69438", "#df6559", "#c65b95", "#885dcc"] as const;
export const GUIDE_POSITION_GRADIENT = "linear-gradient(90deg, " + GUIDE_POSITION_STOPS.map((color, index) => color + " " + index / (GUIDE_POSITION_STOPS.length - 1) * 100 + "%").join(", ") + ")";
export const GUIDE_NO_POSITION_COLOR = "#9aa3a2";
export type GuideColorMode = "book" | "mapped";
export type GuideColorScale = { mode: GuideColorMode; start: number; end: number };
export const GUIDE_BOOK_COLOR_SCALE: GuideColorScale = { mode: "book", start: 0, end: 1 };
// WHY：放大仅改变已关联范围的颜色色阶，真实全书位置不变；图例明确显示当前范围，可切回固定全书色阶。
export function guideColorScale(locations: GuideLocations | null | undefined, mode: GuideColorMode): GuideColorScale {
  const spans = locations?.sources.flatMap(source => source.spans) ?? [];
  if (mode === "book" || !spans.length) return GUIDE_BOOK_COLOR_SCALE;
  const start = spans.reduce((value, span) => Math.min(value, span.start), 1);
  const end = spans.reduce((value, span) => Math.max(value, span.end), 0);
  return end > start ? { mode: "mapped", start, end } : GUIDE_BOOK_COLOR_SCALE;
}
export function guidePositionColor(position: number, scale: GuideColorScale = GUIDE_BOOK_COLOR_SCALE): string {
  if (!Number.isFinite(position)) throw new Error("原文位置不是有限数值");
  if (!Number.isFinite(scale.start) || !Number.isFinite(scale.end) || scale.end <= scale.start || scale.start < 0 || scale.end > 1) throw new Error("位置色阶范围不正确");
  const scaled = Math.max(0, Math.min(1, (position - scale.start) / (scale.end - scale.start))) * (GUIDE_POSITION_STOPS.length - 1);
  const index = Math.min(GUIDE_POSITION_STOPS.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const channel = (offset: number) => Math.round(parseInt(GUIDE_POSITION_STOPS[index].slice(offset, offset + 2), 16) * (1 - mix) + parseInt(GUIDE_POSITION_STOPS[index + 1].slice(offset, offset + 2), 16) * mix).toString(16).padStart(2, "0");
  return "#" + channel(1) + channel(3) + channel(5);
}
export function guidePercentLabel(position: number, precision = 2): string {
  return (position * 100).toLocaleString("zh-CN", { maximumFractionDigits: precision }) + "%";
}
export function guidePositionLabel(span: Pick<GuideLocationSpan, "start" | "end">): string {
  const start = guidePercentLabel(span.start), end = guidePercentLabel(span.end);
  return start === end ? "约 " + start : start + "–" + end;
}
export type GuideLocationGroup = {
  editionId: string; editionLabel: string; chapterTitles: string[];
  start: number; end: number; spans: GuideLocationSpan[]; sourceIds: string[]; hasGap: boolean; lastParagraphIndex?: number;
};
// WHY：只合并来源位置的展示，不拼接或生成原文；相邻段允许归为位置跨度，但实际来源区段仍保留，不能填满未选中的间隔。
export const GUIDE_POSITION_MERGE_GAP = 0.0001; // 全书百分比的 0.01 个百分点，与界面两位小数的精度对应。
export function groupGuideLocations(sources: readonly GuideSourceLocation[]): GuideLocationGroup[] {
  const entries = sources.flatMap(source => source.spans.map(span => ({ source, span }))).sort((a, b) => a.source.editionId.localeCompare(b.source.editionId) || a.span.start - b.span.start || a.span.end - b.span.end);
  const groups: GuideLocationGroup[] = [];
  for (const { source, span } of entries) {
    const previous = groups[groups.length - 1];
    const lastIndex = previous?.lastParagraphIndex;
    const contiguous = previous && span.start <= previous.end;
    const lastSpan = previous?.spans[previous.spans.length - 1];
    // WHY：同章仅隔一段的近邻来源合并为位置跨度；是否近邻由真实段落序号判断，不以舍入后的百分比或标题关键词猜测。
    const maxStep = lastSpan?.chapterId === span.chapterId ? 2 : 1;
    const neighboring = lastIndex !== undefined && span.paragraphIndex !== undefined && span.paragraphIndex >= lastIndex && span.paragraphIndex <= lastIndex + maxStep;
    const sameParagraph = lastSpan?.paragraphId === span.paragraphId;
    // WHY：用户要求近似位置合并；只折叠展示，不修改锚点或把间隔冒充为连续来源。
    const nearby = previous !== undefined && span.start - previous.end <= GUIDE_POSITION_MERGE_GAP;
    if (previous?.editionId === source.editionId && (contiguous || neighboring || sameParagraph || nearby)) {
      previous.hasGap ||= span.start > previous.end;
      previous.end = Math.max(previous.end, span.end);
      previous.spans.push(span);
      if (span.paragraphIndex !== undefined) previous.lastParagraphIndex = Math.max(previous.lastParagraphIndex ?? span.paragraphIndex, span.paragraphIndex);
      if (!previous.sourceIds.includes(source.sourceId)) previous.sourceIds.push(source.sourceId);
      if (!previous.chapterTitles.includes(span.chapterTitle)) previous.chapterTitles.push(span.chapterTitle);
    } else groups.push({ editionId: source.editionId, editionLabel: source.editionLabel, chapterTitles: [span.chapterTitle], start: span.start, end: span.end, spans: [span], sourceIds: [source.sourceId], hasGap: false, lastParagraphIndex: span.paragraphIndex });
  }
  return groups;
}
