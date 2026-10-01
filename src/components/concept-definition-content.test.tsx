// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConceptDefinitionContent } from "./concept-definition-content";
import { conceptReadingVersion, contextualConcept } from "@/lib/concept-reading";
import type { TextAnnotation } from "@/lib/annotations";

const name = "等价形式";
const annotation = (id: string, text: string, createdAt: string): TextAnnotation => ({
  id, messageId: "unit-" + id, threadId: "t", paragraphId: "p", startOffset: 0, endOffset: 4,
  textHash: "h", concepts: [name], conceptDetails: [{ name, text }], summary: "不能借用摘要", createdAt,
});
function concept(entries: TextAnnotation[]) {
  return contextualConcept(name, { paragraphId: "p", startOffset: 0, endOffset: 4 }, entries.map(item => conceptReadingVersion(item, item.conceptDetails![0])));
}
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("句读关键词浮窗", () => {
  it("默认显示此处最新解释，历史默认折叠且拥有独立来源", async () => {
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([annotation("old", "旧的本句解释", "2026-10-01"), annotation("new", "新的本句解释", "2026-10-02")])}/>));
    const current = host.querySelector('[data-concept-unit-id="unit-new"]')!;
    expect(current.textContent).toContain("新的本句解释");
    expect(current.textContent).not.toContain("旧的本句解释");
    const history = host.querySelector("details")!;
    expect(history.open).toBe(false);
    expect(history.querySelector("summary")?.textContent).toBe("此处历史解释（1）");
    expect(history.querySelector('[data-concept-unit-id="unit-old"]')?.textContent).toContain("旧的本句解释");
    await act(async () => { history.open = true; });
    expect(history.open).toBe(true);
    expect(host.querySelector('[data-concept-paragraph-id="p"]')?.getAttribute("data-concept-start")).toBe("0");
  });
  it("最新缺少定义时显示暂无定义，旧解释仅在历史中", async () => {
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([annotation("old", "此前解释", "2026-10-01"), annotation("new", "", "2026-10-02")])}/>));
    expect(host.querySelector('[data-concept-unit-id="unit-new"]')?.textContent).toContain("暂无定义");
    expect(host.querySelector('[data-concept-unit-id="unit-new"]')?.textContent).not.toContain("此前解释");
    expect(host.textContent).not.toContain("不能借用摘要");
  });
  it("只有一份定义不显示历史入口，旧版无来源数据仍兼容", async () => {
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([annotation("a", "本句定义", "2026-10-02")])}/>));
    expect(host.querySelector("details")).toBeNull();
    await act(async () => root.render(<ConceptDefinitionContent concept={{ name, definitions: [{ name, text: "旧格式定义" }] }}/>));
    expect(host.textContent).toBe("旧格式定义");
  });
  it("新的句读版本到达时即时更新默认解释并重新折叠历史", async () => {
    const old = annotation("a", "第一版", "2026-09-30"), second = annotation("b", "第二版", "2026-10-01");
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([old, second])}/>));
    host.querySelector("details")!.open = true;
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([old, second, annotation("c", "第三版", "2026-10-02")])}/>));
    expect(host.querySelector('[data-concept-unit-id="unit-c"]')?.textContent).toContain("第三版");
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.querySelectorAll("li")).toHaveLength(2);
  });
  it("Agent 文本按原文展示，不能注入 HTML 或链接", async () => {
    const text = '<img src="https://unsafe.invalid/"/> **解释**';
    await act(async () => root.render(<ConceptDefinitionContent concept={concept([annotation("a", text, "2026-10-02")])}/>));
    expect(host.textContent).toContain(text);
    expect(host.querySelector("img,a")).toBeNull();
  });
});
