// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeWorkspace } from "./knowledge-workspace";
import type { BookKnowledge } from "@/lib/knowledge";
let root: Root; let host: HTMLDivElement;
const onReturnReading = vi.fn(), onOpenSource = vi.fn(), onOpenConversation = vi.fn();
const anchor = { editionId: "e", chapterId: "c", paragraphId: "p", startOffset: 0, endOffset: 2, selectedText: "承认" };
const data: BookKnowledge = { editionId: "e", concepts: [{ id: "term", name: "承认", definitions: [{ text: "互相确认", recordIds: ["r"] }], recordIds: ["r"], updatedAt: "2026-09-14" }], records: [{ id: "r", editionId: "e", annotationId: "a", messageId: "m", threadId: "t", createdAt: "2026-09-14", summary: "句读内容", excerpt: "承认", chapterTitle: "第一章", anchor, locationReason: null, concepts: [{ name: "承认", text: "互相确认" }] }] };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(async () => Response.json(data))); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<KnowledgeWorkspace editionId="e" bookTitle="测试书" onReturnReading={onReturnReading} onOpenSource={onOpenSource} onOpenConversation={onOpenConversation} />); }); }
describe("KnowledgeWorkspace", () => {
  it("复用真实知识卡，放在中央工作区而不是聊天面板", async () => {
    await mount(); expect(host.querySelector('.knowledge-workspace [data-concept-name="承认"]')?.textContent).toContain("互相确认");
    expect(host.querySelector(".analysis-panel")).toBeNull(); expect(host.querySelector('[aria-label="返回对话"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>(".workspace-heading button")?.click()); expect(onReturnReading).toHaveBeenCalledOnce();
  });
  it("记录保留原文锚点和具体消息定位回调", async () => {
    await mount(); const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent?.startsWith("句读记录"))!;
    act(() => tab.click()); const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-record-id="r"] button')];
    act(() => buttons.find(item => item.textContent === "打开原文")?.click()); expect(onOpenSource).toHaveBeenCalledWith(anchor, data.records[0]);
    act(() => buttons.find(item => item.textContent === "打开对话")?.click()); expect(onOpenConversation).toHaveBeenCalledWith("t", "m");
  });
});
