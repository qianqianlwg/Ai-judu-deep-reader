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
  it("服务端区分选文、预加载上下文与真正检索，不让后续检索改写首次来源", async () => {
    const { deps, tools } = fixture();
    const context = { ...source, text: "选中部分。相邻部分。", origin: "context" as const };
    deps.selectedText = "选中部分。";
    deps.anchor = { paragraphId: "p", startOffset: 0, endOffset: 5, selectedText: "选中部分。" };
    deps.sources.set(context.sourceId, context);
    deps.sources.set("book:e:paragraph:near", { ...context, sourceId: "book:e:paragraph:near", paragraphId: "near", text: "邻段原文。" });
    const found = { ...source, sourceId: "book:e:paragraph:found", paragraphId: "found", text: "检索原文。" };
    deps.search = vi.fn(async () => [context, found]);
    await tools[0].invoke({ query: "检索" });
    const result = await tools[2].invoke({ ...analysis, concepts: [], citations: [
      { sourceId: context.sourceId, quote: "选中部分。" },
      { sourceId: context.sourceId, quote: "相邻部分。" },
      { sourceId: "book:e:paragraph:near", quote: "邻段原文。" },
      { sourceId: found.sourceId, quote: "检索原文。" },
    ] });
    expect(result).toMatchObject({ ok: true, result: { provenanceVersion: 1, citations: [
      { origin: "selection" }, { origin: "context" }, { origin: "context" }, { origin: "search" },
    ] } });
    expect(deps.sources.get(context.sourceId)?.origin).toBe("context");
  });
  it("跨段选文的第二段也标为选文依据", async () => {
    const { deps, tools } = fixture();
    const first = { paragraphId: "p", startOffset: 0, endOffset: 2, selectedText: "认识" };
    const second = { paragraphId: "p2", startOffset: 0, endOffset: 4, selectedText: "第二段选文" };
    deps.anchor = { ...first, version: 2, fragments: [first, second] };
    deps.sources.set("book:e:paragraph:p2", { ...source, sourceId: "book:e:paragraph:p2", paragraphId: "p2", text: "第二段选文及后文", origin: "context" });
    expect(await tools[2].invoke({ ...analysis, citations: [{ sourceId: "book:e:paragraph:p2", quote: "第二段选文" }] }))
      .toMatchObject({ ok: true, result: { citations: [{ origin: "selection" }] } });
  });
  it("同段新检索片段中的引文不会冒充预加载上下文", async () => {
    const { deps, tools } = fixture();
    deps.sources.set(source.sourceId, { ...source, text: "旧上下文", origin: "context" });
    deps.search = vi.fn(async () => [{ ...source, text: "新检索片段" }]);
    await tools[0].invoke({ query: "新检索片段" });
    expect(await tools[2].invoke({ ...analysis, concepts: [], citations: [{ sourceId: source.sourceId, quote: "新检索片段" }] }))
      .toMatchObject({ ok: true, result: { citations: [{ origin: "search" }] } });
  });
  it("未经验证的选区不标作选文依据", async () => {
    const { deps, tools } = fixture(); deps.anchor = undefined;
    await tools[0].invoke({ query: "认识" });
    expect(await tools[2].invoke(analysis)).toMatchObject({ ok: true, result: { citations: [{ origin: "search" }] } });
  });
  it("未检索来源或伪造引文不会被保存", async () => { const { deps, tools } = fixture(); expect(await tools[2].invoke(analysis)).toMatchObject({ ok: false }); await tools[0].invoke({ query: "认识" }); expect(await tools[2].invoke({ ...analysis, citations: [{ sourceId: source.sourceId, quote: "不存在的原文" }] })).toMatchObject({ ok: false }); expect(deps.save).not.toHaveBeenCalled(); });
  it("概念必须逐字存在，不把整段分析标题加粗成关键词", async () => { const { deps, tools } = fixture(); expect(await tools[2].invoke({ ...analysis, concepts: [{ name: "自我意识与对象关系", text: "说明" }] })).toMatchObject({ ok: false }); expect(deps.save).not.toHaveBeenCalled(); });
  it("普通聊天无选文时不能保存句读", async () => { const { deps } = fixture(); deps.selectedText = ""; expect(await createReadingTools(deps)[2].invoke(analysis)).toMatchObject({ ok: false }); });
  it("只保存可见正文逐字匹配的语义标注，不接受模型颜色与虚构文本", async () => {
    const { deps, tools } = fixture();
    deps.getVisibleAnswer = () => "先看影响范围，再确定协调责任。";
    deps.saveEmphasis = vi.fn(async () => undefined);
    const proposal = { version: 1 as const, marks: [{ kind: "term" as const, quote: "影响范围", occurrence: 1 }] };
    expect(await tools[3].invoke(proposal)).toMatchObject({ ok: true, marked: 1 });
    expect(deps.saveEmphasis).toHaveBeenCalledWith(proposal);
    expect(await tools[3].invoke({ version: 1, marks: [{ kind: "term", quote: "不存在", occurrence: 1 }] })).toMatchObject({ ok: false });
    expect(deps.saveEmphasis).toHaveBeenCalledOnce();
    await expect(tools[3].invoke({ version: 1, marks: [{ kind: "term", quote: "影响范围", occurrence: 1, style: "color:red" }] })).rejects.toThrow();
  });
  it("句读保存工具将强调和完整回答分开，失配标注不影响正常保存", async () => {
    const { deps, tools } = fixture();
    deps.getVisibleAnswer = () => "认识活动改变对象。";
    await tools[0].invoke({ query: "认识" });
    await tools[2].invoke({ ...analysis, emphasis: { version: 1, marks: [{ kind: "term", quote: "认识活动", occurrence: 1 }] } });
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ emphasis: { version: 1, marks: [{ kind: "term", quote: "认识活动", occurrence: 1 }] } }));
    await tools[2].invoke({ ...analysis, emphasis: { version: 1, marks: [{ kind: "term", quote: "不存在", occurrence: 1 }] } });
    expect(deps.save).toHaveBeenLastCalledWith(expect.not.objectContaining({ emphasis: expect.anything() }));
  });  it("read_source 拒绝未登记 ID", async () => { const { deps, tools } = fixture(); expect(await tools[1].invoke({ sourceId: "other-edition" })).toMatchObject({ ok: false }); expect(deps.read).not.toHaveBeenCalled(); });
  it("同一段多次检索保留已提供的证据，但不跨片段拼接引用", async () => {
    const { deps, tools } = fixture(); let second=false; deps.search=vi.fn(async()=>[{...source,text:second?"对象有独立性":"认识改变对象"}]);
    await tools[0].invoke({query:"认识"}); second=true; await tools[0].invoke({query:"对象"});
    expect(await tools[2].invoke(analysis)).toMatchObject({ok:true});
    expect(await tools[2].invoke({...analysis,citations:[{sourceId:source.sourceId,quote:"认识改变对象对象有独立性"}]})).toMatchObject({ok:false});
  });

});

it("保存长于长度目标的句读不再因字数拒绝，伪造来源校验仍保留", async () => {
  const { deps, tools } = fixture();
  const longText = "释".repeat(1500);
  expect(await tools[2].invoke({ ...analysis, readingText: longText, summary: "补充".repeat(800), citations: [] })).toMatchObject({ ok: true });
  expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ readingText: longText }));
  expect(await tools[2].invoke({ ...analysis, readingText: longText, citations: [{ sourceId: "fake", quote: "伪造" }] })).toMatchObject({ ok: false, code: "invalid_citation" });
});
