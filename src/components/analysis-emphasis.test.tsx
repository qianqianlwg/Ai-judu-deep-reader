// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisPanel, type Analysis } from "./analysis-panel";
let container: HTMLDivElement, root: Root;
const analysis: Analysis = { readingText: "句读正文。", summary: "摘要", breakdown: [], concepts: [], context: "", uncertainty: "" };
const render = async (props: Partial<Parameters<typeof AnalysisPanel>[0]>) => { await act(async () => root.render(<AnalysisPanel selected="" analysis={null} loading={false} onClose={() => undefined} onBack={() => undefined} {...props} />)); };
const message = (id: string) => container.querySelector<HTMLElement>('[data-message-id="' + id + '"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("回答关键词与关键句色彩标注", () => {
  const content = "关键不在层级越高越好，而在于影响范围。\n\n应先看影响范围，再确定协调责任。";
  const emphasis = { version: 1 as const, marks: [
    { kind: "key_sentence" as const, quote: "关键不在层级越高越好，而在于影响范围。", occurrence: 1 },
    { kind: "term" as const, quote: "协调责任", occurrence: 1 },
  ] };
  it("同一条完成消息保留原字句并按独立元数据着色", async () => {
    await render({ messages: [{ id: "colored", role: "assistant", content, emphasis, tools: [{ id: "mark-1", name: "mark_answer_emphasis", status: "completed", result: { ok: true, marked: 2 } }], status: "completed", outputFormat: "text" }] });
    const html = message("colored");
    expect(html.querySelectorAll('[data-answer-emphasis="key_sentence"]')).toHaveLength(1);
    expect(html.querySelector('[data-answer-emphasis="term"]')?.textContent).toBe("协调责任");
    expect(html.querySelector('[data-streaming-format="markdown"]')?.textContent?.replace(/\s+/gu, "")).toBe(content.replace(/\s+/gu, ""));
    expect(html.textContent).not.toContain("#关键词#");
    expect(html.querySelector('[data-tool-id="mark-1"]')).toBeNull();
  });
  it("流式及错误状态不出现标注，非法元数据不会执行 HTML", async () => {
    await render({ messages: [{ id: "incomplete", role: "assistant", content, emphasis, status: "streaming" }] });
    expect(message("incomplete").querySelector('[data-answer-emphasis]')).toBeNull();
    await render({ messages: [{ id: "incomplete", role: "assistant", content, emphasis, status: "error" }] });
    expect(message("incomplete").querySelector('[data-answer-emphasis]')).toBeNull();
    await render({ messages: [{ id: "incomplete", role: "assistant", content: "安全 <script>危险</script> 解释", emphasis, status: "completed" }] });
    expect(message("incomplete").querySelector('script')).toBeNull();
    expect(message("incomplete").querySelector('[data-answer-emphasis]')).toBeNull();
  });
});

it("合并后保留普通 Markdown 兼容，但不再把星号作为右侧高亮协议", async () => {
  const text = "**关键词**与*关键句。*";
  await render({ messages: [
    { id: "chat", role: "assistant", kind: "chat", content: text, outputFormat: "text", status: "completed" },
    { id: "legacy", role: "assistant", kind: "analysis", content: "旧结构化内容", outputFormat: "legacy-json", status: "completed", analysis: { ...analysis, readingText: text } },
  ] });
  expect(message("chat").querySelector('[data-reading-markup]')).toBeNull();
  const record = message("legacy").querySelector('.reading-text-result')!;
  expect(record.querySelector("strong")?.textContent).toBe("关键词");
  expect(record.querySelector("em")?.textContent).toBe("关键句。");
  expect(record.textContent).not.toContain("*");
  const css = await readFile("src/components/analysis-panel.module.css", "utf8");
  expect(css).not.toContain('[data-reading-markup=');
  expect(css).toContain('[data-answer-emphasis="term"]');
  expect(css).toContain('var(--reading-term-background)');
});

it("右侧重点在工具时间线分段后仍指向指定的第二次原词，且保留朗读和来源记录", async () => {
  const content = "影响范围在前。\n\n再次讨论影响范围。";
  const split = content.indexOf("再次");
  await render({ messages: [{ id: "merged", role: "assistant", kind: "analysis", status: "completed", content, outputFormat: "text",
    emphasis: { version: 1, marks: [{ kind: "term", quote: "影响范围", occurrence: 2 }] },
    analysis, analysisOffset: split, tools: [{ id: "save-merged", name: "save_reading_analysis", status: "completed", contentOffset: split, result: { ok: true, saved: true } }],
  }] });
  const group = message("merged");
  const body = group.querySelector('[data-streaming-format="markdown"]')!;
  expect(body.querySelectorAll('[data-answer-emphasis="term"]')).toHaveLength(1);
  const pieces = body.querySelectorAll('[data-output-format="text"]');
  expect(pieces[0].querySelector('[data-answer-emphasis]')).toBeNull();
  expect(pieces[pieces.length - 1].querySelector('[data-answer-emphasis="term"]')?.textContent).toBe("影响范围");
  expect(group.querySelector('[data-tool-id="save-merged"]')).not.toBeNull();
  expect(group.querySelector('[data-testid="analysis-record"]')).not.toBeNull();
  expect(group.querySelector('[aria-label*="朗读"]')).not.toBeNull();
});

it("句读记录和保存调用按正文产生时点穿插，而非全部落在末尾", async () => {
 await render({messages:[{id:"timed",role:"assistant",status:"completed",outputFormat:"text",content:"前段\n\n后段",analysis,analysisOffset:2,tools:[{id:"save",name:"save_reading_analysis",status:"completed",contentOffset:2,result:{ok:true,saved:true}}]}]});
 const group=message("timed");
 const children=[...group.querySelector('[data-streaming-format="markdown"]')!.children];
 expect(children).toHaveLength(4);
 expect(children[0].textContent).toBe("前段");
 expect(children[1].matches("[data-tool-id=save]")).toBe(true);
 expect(children[2].matches("[data-testid=analysis-record]")).toBe(true);
 expect(children[3].textContent).toBe("后段");
 expect(group.querySelectorAll('[data-tool-id="save"]')).toHaveLength(1);
});
