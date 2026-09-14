"use client";

import { KnowledgePanel, type KnowledgePanelProps } from "./knowledge-panel";
import "./knowledge-workspace.css";

export type KnowledgeWorkspaceProps = Omit<KnowledgePanelProps, "onClose" | "className"> & { onReturnReading: () => void };
export function KnowledgeWorkspace({ onReturnReading, ...props }: KnowledgeWorkspaceProps) {
  // WHY：复用已经校验版本/锚点的知识模块，但仅放入中央工作区；右侧聊天不卸载、不被卡片替换。
  return <section className="knowledge-workspace" aria-label="知识库工作区">
    <header className="workspace-heading"><div><p>随阅读积累</p><h1>知识库</h1></div><button type="button" onClick={onReturnReading}>返回阅读</button></header>
    <KnowledgePanel {...props} className="workspace-knowledge-panel" />
  </section>;
}
