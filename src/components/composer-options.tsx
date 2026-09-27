"use client";

import { useState } from "react";
import styles from "./composer-options.module.css";
import { ExternalPermissionsMenu } from "./external-permissions";
import type { ExternalPermissions } from "@/lib/agent/external-permissions";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ComposerOptionsProps = {
  disabled?: boolean;
  bookContextPrefetch?: boolean;
  onBookContextPrefetchChange?: (value: boolean) => void;
  externalPermissions?: ExternalPermissions;
  onExternalPermissionsChange?: (value: ExternalPermissions) => void;
  modelName?: string;
  modelOptions?: readonly string[];
  selectedModel?: string;
  reasoningEffort?: ReasoningEffort;
  onModelChange?: (model: string) => void;
  onReasoningChange?: (effort: ReasoningEffort) => void;
  onPluginSelect?: (pluginId: "knowledge-base") => void;
  onCitationSelect?: () => void;
};
const REASONING_OPTIONS: readonly { value: ReasoningEffort; label: string }[] = [
  { value: "none", label: "不思考" }, { value: "minimal", label: "极低" }, { value: "low", label: "低" },
  { value: "medium", label: "中" }, { value: "high", label: "高" }, { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" }, { value: "ultra", label: "Ultra" },
];
export function ComposerOptions({ disabled = false, modelName, modelOptions = [], selectedModel, reasoningEffort, onModelChange, onReasoningChange, onPluginSelect, onCitationSelect, externalPermissions, onExternalPermissionsChange, bookContextPrefetch = false, onBookContextPrefetchChange }: ComposerOptionsProps) {
  const [open, setOpen] = useState(false);
  const [localModel, setLocalModel] = useState(selectedModel ?? modelName ?? "");
  const [localReasoning, setLocalReasoning] = useState<ReasoningEffort>(reasoningEffort ?? "medium");
  const [notice, setNotice] = useState("");
  const models = modelOptions.length ? modelOptions : modelName ? [modelName] : [];
  const activeModel = selectedModel ?? localModel;
  const activeReasoning = reasoningEffort ?? localReasoning;
  function changeModel(model: string) { setLocalModel(model); onModelChange?.(model); }
  function changeReasoning(effort: ReasoningEffort) { setLocalReasoning(effort); onReasoningChange?.(effort); }
  function choosePlugin() { if (onPluginSelect) { setNotice(""); onPluginSelect("knowledge-base"); } else setNotice("知识库插件暂未接通"); }
  function chooseCitation() { if (onCitationSelect) { setNotice(""); onCitationSelect(); } else setNotice("引用功能暂未接通"); }
  return <div className={styles.root}>
      <label className={styles.field}>模型<select aria-label="选择模型" value={activeModel} disabled={disabled || models.length === 0} onChange={event => changeModel(event.target.value)}>
        {models.length === 0 ? <option value="">未选择模型</option> : models.map(model => <option key={model} value={model}>{model}</option>)}
      </select></label>
    <button type="button" className={styles.plus} aria-label="打开插件和引用菜单" aria-expanded={open} onClick={() => { setOpen(value => !value); setNotice(""); }}>+</button>
    {open && <div className={styles.menu} role="menu" aria-label="聊天选项">
      <div className={styles.section}>
        <span className={styles.sectionTitle}>{disabled ? "生成中 · 设置只读（可点 + 收起）" : "对话选项"}</span>
        <button type="button" className={styles.option} role="menuitem" disabled={disabled} onClick={choosePlugin}>插件 <small>知识库 · 未接通</small></button>
        <button type="button" className={styles.option} role="menuitem" disabled={disabled} onClick={chooseCitation}>引用 <small>文献引用 · 未接通</small></button>
      </div>

      {onBookContextPrefetchChange && <label className={styles.prefetch}><input type="checkbox" checked={bookContextPrefetch} disabled={disabled} onChange={event => onBookContextPrefetchChange(event.target.checked)} />句读前关联本书原文<small>仅已建索引；裁剪选文发送至向量服务，不回注当前段落</small></label>}
      {externalPermissions && onExternalPermissionsChange && <ExternalPermissionsMenu permissions={externalPermissions} onChange={onExternalPermissionsChange} disabled={disabled} />}
      <label className={styles.field}>思考强度<select aria-label="选择思考强度" value={activeReasoning} disabled={disabled} onChange={event => changeReasoning(event.target.value as ReasoningEffort)}>
        {REASONING_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>}
  </div>;
}
