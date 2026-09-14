import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgePanel, KnowledgePanelView, type KnowledgePanelViewProps } from "./knowledge-panel";
import type { BookKnowledge } from "@/lib/knowledge";

const anchor = { editionId: "e1", chapterId: "c1", paragraphId: "p1", startOffset: 0, endOffset: 2, selectedText: "承认" };
const data: BookKnowledge = { editionId: "e1", records: [{ id: "r1", editionId: "e1", annotationId: "a1",
  messageId: "m1", threadId: "t1", createdAt: "2026-09-15T01:00:00Z", summary: "两个自我意识彼此确认。",
  excerpt: "承认", chapterTitle: "自我意识", anchor, locationReason: null,
  concepts: [{ name: "承认", text: "主体之间的互相确认。" }],
}], concepts: [{ id: "concept:承认", name: "承认", definitions: [{ text: "主体之间的互相确认。", recordIds: ["r1"] }],
  recordIds: ["r1"], updatedAt: "2026-09-15T01:00:00Z" }] };
function props(extra: Partial<KnowledgePanelViewProps> = {}): KnowledgePanelViewProps {
  return { state: { status: "ready", data }, tab: "concepts", query: "", idPrefix: "test-knowledge",
    onTabChange: vi.fn(), onQueryChange: vi.fn(), onRefresh: vi.fn(),
    onOpenSource: vi.fn(), onOpenConversation: vi.fn(), ...extra };
}

type NodeProps = {
  children?: unknown;
  role?: string;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void; currentTarget: { parentElement: null } }) => void;
};
function nodes(value: unknown): ReactElement<NodeProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<NodeProps>(value)) return [];
  if (typeof value.type === "function") {
    return nodes((value.type as (props: unknown) => unknown)(value.props));
  }
  return [value, ...nodes(value.props.children)];
}
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return isValidElement<NodeProps>(value) ? text(value.props.children) : "";
}
function button(view: ReactElement, label: string): ReactElement<NodeProps> {
  const result = nodes(view).find((node) => node.type === "button" && text(node) === label);
  if (!result) throw new Error("未找到按钮：" + label);
  return result;
}

describe("KnowledgePanel", () => {
  it("独立嵌入时初始呈现加载态，没有书时明确提示选择书籍", () => {
    const loading = renderToStaticMarkup(<KnowledgePanel editionId="e1" bookTitle="精神现象学" />);
    expect(loading).toContain("正在读取本书知识");
    expect(loading).toContain("精神现象学");
    expect(loading).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<KnowledgePanel editionId={null} />)).toContain("请先选择或导入一本书");
  });

  it("展示概念定义、来源和完整消息导航，不输出 JSON", () => {
    const markup = renderToStaticMarkup(<KnowledgePanelView {...props()} />);
    expect(markup).toContain("主体之间的互相确认。");
    expect(markup).toContain("查看 1 条句读来源");
    expect(markup).toContain("原文摘录");
    expect(markup).not.toContain('"summary"');
    expect(markup).toContain("全书范围");
  });

  it("句读记录展示摘要、原文、时间和章节", () => {
    const markup = renderToStaticMarkup(<KnowledgePanelView {...props({ tab: "records" })} />);
    expect(markup).toContain("两个自我意识彼此确认。");
    expect(markup).toContain("自我意识");
    expect(markup).toMatch(/datetime="2026-09-15T01:00:00Z"/iu);
    expect(markup).toContain("本次关键概念");
  });

  it("原文与对话按钮传回精确 anchor、threadId、messageId", () => {
    const options = props({ tab: "records" });
    const view = KnowledgePanelView(options);
    button(view, "打开原文").props.onClick?.();
    button(view, "打开对话").props.onClick?.();
    expect(options.onOpenSource).toHaveBeenCalledWith(anchor, data.records[0]);
    expect(options.onOpenConversation).toHaveBeenCalledWith("t1", "m1");
  });

  it("旧历史禁用原文跳转并显示原因，不猜测位置", () => {
    const legacy: BookKnowledge = { ...data, records: [{ ...data.records[0], anchor: null, excerpt: "",
      locationReason: "历史记录未保存准确的文本锚点，暂不支持原文跳转。", messageId: null }] };
    const options = props({ tab: "records", state: { status: "ready", data: legacy } });
    const view = KnowledgePanelView(options);
    expect(button(view, "打开原文").props.disabled).toBe(true);
    button(view, "打开原文").props.onClick?.();
    expect(options.onOpenSource).not.toHaveBeenCalled();
    button(view, "打开所属对话").props.onClick?.();
    expect(options.onOpenConversation).toHaveBeenCalledWith("t1", null);
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("暂不支持原文跳转");
    expect(markup).toContain("旧记录未保存可核验的原文摘录");
  });

  it("无有效 threadId 的旧标注无法跳到错误对话", () => {
    const view = KnowledgePanelView(props({ tab: "records", state: { status: "ready",
      data: { ...data, records: [{ ...data.records[0], threadId: null, messageId: null }] } } }));
    expect(button(view, "打开所属对话").props.disabled).toBe(true);
  });

  it("可点击或用键盘切换概念/句读 tabs", () => {
    const options = props();
    const view = KnowledgePanelView(options);
    const tabs = nodes(view).filter((node) => node.props.role === "tab");
    tabs[1].props.onClick?.();
    expect(options.onTabChange).toHaveBeenCalledWith("records");
    const preventDefault = vi.fn();
    tabs[1].props.onKeyDown?.({ key: "Home", preventDefault, currentTarget: { parentElement: null } });
    expect(options.onTabChange).toHaveBeenLastCalledWith("concepts");
    expect(preventDefault).toHaveBeenCalled();
  });

  it("搜索可过滤及清空，输入变化回传给容器", () => {
    const options = props({ query: "不存在" });
    const view = KnowledgePanelView(options);
    expect(renderToStaticMarkup(view)).toContain("没有找到匹配的知识卡片");
    nodes(view).find((node) => node.type === "input")?.props.onChange?.({ currentTarget: { value: "承认" } });
    expect(options.onQueryChange).toHaveBeenCalledWith("承认");
    button(view, "清空搜索").props.onClick?.();
    expect(options.onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("空/错误态可理解，并支持主动刷新与重试", () => {
    const empty = renderToStaticMarkup(<KnowledgePanelView {...props({ state: { status: "ready",
      data: { editionId: "e1", records: [], concepts: [] } } })} />);
    expect(empty).toContain("还没有关键概念");
    expect(empty).toContain("普通聊天不会列入");
    const options = props({ state: { status: "error", error: "连接暂时失败" } });
    const view = KnowledgePanelView(options);
    expect(renderToStaticMarkup(view)).toContain('role="alert"');
    button(view, "重新加载").props.onClick?.();
    button(view, "刷新").props.onClick?.();
    expect(options.onRefresh).toHaveBeenCalledTimes(2);
  });

  it("切书重建局部状态，refreshToken 传入加载容器", () => {
    const first = KnowledgePanel({ editionId: "e1", refreshToken: 1 });
    const refreshed = KnowledgePanel({ editionId: "e1", refreshToken: 2 });
    const switched = KnowledgePanel({ editionId: "e2", refreshToken: 2 });
    expect(first.key).toBe(refreshed.key);
    expect(first.key).not.toBe(switched.key);
    expect(refreshed.props.refreshToken).toBe(2);
  });

  it("旧关键词无释义时明确说明，不自行补写", () => {
    const legacy: BookKnowledge = { ...data, concepts: [{ ...data.concepts[0], definitions: [] }] };
    expect(renderToStaticMarkup(<KnowledgePanelView {...props({ state: { status: "ready", data: legacy } })} />))
      .toContain("未保存概念定义");
  });
});
