import { describe, expect, it, vi } from "vitest";
import { createReadingTools, type ReadingToolDependencies } from "./tools";
const source = { sourceId: "book:e:paragraph:p", paragraphId: "p", chapterId: "c", chapterTitle: "导论", text: "认识使对象改变并使我们得到经过工具影响的对象" };
function fixture() {
  const deps: ReadingToolDependencies = { messageId: "m", selectedText: source.text, detail: "standard", sources: new Map(), search: vi.fn(async () => [source]), read: vi.fn(async () => [source]), save: vi.fn(async () => undefined), anchor: { paragraphId: "p", startOffset: 0, endOffset: source.text.length, selectedText: source.text } };
  return { deps, tools: createReadingTools(deps) };
}
const analysis = { readingText: "认识使对象改变啊", summary: "解释", breakdown: [], concepts: [{ name: "认识", text: "认识活动" }], context: "", uncertainty: "", citations: [{ sourceId: source.sourceId, quote: "认识" }] };
describe("结构化句读工具", () => {
  it("只登记实际检索结果，然后验证并保存原文锚点", async () => { const { deps, tools } = fixture(); await tools[0].invoke({ query: "认识" }); expect(deps.sources.size).toBe(1); const result = await tools[2].invoke(analysis); expect(result).toMatchObject({ ok: true, analysisId: "m", saved: true }); expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ anchor: deps.anchor, citations: [expect.objectContaining({ paragraphId: "p", messageId: "m" })] })); });
  it("未检索来源或伪造引文不会被保存", async () => { const { deps, tools } = fixture(); expect(await tools[2].invoke(analysis)).toMatchObject({ ok: false }); await tools[0].invoke({ query: "认识" }); expect(await tools[2].invoke({ ...analysis, citations: [{ sourceId: source.sourceId, quote: "不存在的原文" }] })).toMatchObject({ ok: false }); expect(deps.save).not.toHaveBeenCalled(); });
  it("概念必须逐字存在，不把整段分析标题加粗成关键词", async () => { const { deps, tools } = fixture(); expect(await tools[2].invoke({ ...analysis, concepts: [{ name: "自我意识与对象关系", text: "说明" }] })).toMatchObject({ ok: false }); expect(deps.save).not.toHaveBeenCalled(); });
  it("普通聊天无选文时不能保存句读", async () => { const { deps } = fixture(); deps.selectedText = ""; expect(await createReadingTools(deps)[2].invoke(analysis)).toMatchObject({ ok: false }); });
  it("read_source 拒绝未登记 ID", async () => { const { deps, tools } = fixture(); expect(await tools[1].invoke({ sourceId: "other-edition" })).toMatchObject({ ok: false }); expect(deps.read).not.toHaveBeenCalled(); });
  it("同一段多次检索保留已提供的证据，但不跨片段拼接引用", async () => {
    const { deps, tools } = fixture(); let second=false; deps.search=vi.fn(async()=>[{...source,text:second?"对象有独立性":"认识改变对象"}]);
    await tools[0].invoke({query:"认识"}); second=true; await tools[0].invoke({query:"对象"});
    expect(await tools[2].invoke(analysis)).toMatchObject({ok:true});
    expect(await tools[2].invoke({...analysis,citations:[{sourceId:source.sourceId,quote:"认识改变对象对象有独立性"}]})).toMatchObject({ok:false});
  });

});
