"use client";

import { READING_DETAIL_OPTIONS, normalizeReadingDetail, readingDetailSpec } from "@/lib/reading-detail";
import { READING_DIFFICULTY_OPTIONS, READING_DIFFICULTY_LABELS, normalizeReadingDifficulty, type ReadingPreferences } from "@/lib/reading-preferences";
import { useState } from "react";
import styles from "./composer-options.module.css";
import { ExternalPermissionsMenu } from "./external-permissions";
import type { ExternalPermissions } from "@/lib/agent/external-permissions";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ComposerOptionsProps = {
  disabled?: boolean;
  generating?: boolean;
  readingPreferences?: ReadingPreferences;
  onReadingPreferencesChange?: (value: ReadingPreferences) => void;
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
function OptionIcon({ kind }: { kind: "plugin" | "quote" }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "plugin" ? <><path d="M5 4h5v4a2 2 0 1 0 4 0V4h5v6h-3a2 2 0 0 0 0 4h3v6H5v-6h3a2 2 0 0 0 0-4H5z"/></> : <><path d="M10 5H5v6h5v7H4v-7a6 6 0 0 1 6-6ZM20 5h-5v6h5v7h-6v-7a6 6 0 0 1 6-6Z"/></>}
  </svg>;
}
export function ComposerOptions({ readingPreferences, onReadingPreferencesChange, disabled = false, generating = false, modelName, modelOptions = [], selectedModel, reasoningEffort, onModelChange, onReasoningChange, onPluginSelect, onCitationSelect, externalPermissions, onExternalPermissionsChange, bookContextPrefetch = false, onBookContextPrefetchChange }: ComposerOptionsProps) {
  const [open, setOpen] = useState(false);
  const [localModel, setLocalModel] = useState(selectedModel ?? modelName ?? "");
  const [localReasoning, setLocalReasoning] = useState<ReasoningEffort>(reasoningEffort ?? "medium");
  const [notice, setNotice] = useState("");
  // WHY：父组件在进入生成态时重新挂载输入选项，收起遮挡回复的悬浮菜单；+ 仍可再次打开或关闭。
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
        <span className={styles.sectionTitle}>{disabled ? "正在加载 · 设置暂不可用" : generating ? "生成中 · 设置调整仅对下一轮生效" : "对话选项"}</span>
        <button type="button" className={styles.option} role="menuitem" disabled={disabled} onClick={choosePlugin}><span className={styles.optionIcon}><OptionIcon kind="plugin" /></span><span className={styles.optionText}><strong>本地插件</strong><small>知识库 · 未接通</small></span><span className={styles.optionChevron} aria-hidden="true">›</span></button>
        <button type="button" className={styles.option} role="menuitem" disabled={disabled} onClick={chooseCitation}><span className={styles.optionIcon}><OptionIcon kind="quote" /></span><span className={styles.optionText}><strong>引用</strong><small>文献引用 · 未接通</small></span><span className={styles.optionChevron} aria-hidden="true">›</span></button>
      </div>

      {readingPreferences && onReadingPreferencesChange && <div className={styles.section}>
        <span className={styles.sectionTitle}>仅本书 · 下次回复生效 · 不修改当前回复</span>
        <label className={styles.field}>解读方式<select aria-label="解读方式" value={readingPreferences.difficulty} onChange={event => onReadingPreferencesChange({ ...readingPreferences, difficulty: normalizeReadingDifficulty(event.target.value) })}>
          {READING_DIFFICULTY_OPTIONS.map(value => <option key={value} value={value}>{READING_DIFFICULTY_LABELS[value]}</option>)}
        </select></label>
        <label className={styles.field}>回复长度<select aria-label="回复长度" value={readingPreferences.detail} onChange={event => onReadingPreferencesChange({ ...readingPreferences, detail: normalizeReadingDetail(event.target.value) })}>
          {READING_DETAIL_OPTIONS.map(value => <option key={value} value={value}>{readingDetailSpec(value).label}（约 {readingDetailSpec(value).ratio * 100}%）</option>)}
        </select></label>
      </div>}
      {onBookContextPrefetchChange && <label className={styles.prefetch}><input type="checkbox" checked={bookContextPrefetch} disabled={disabled} onChange={event => onBookContextPrefetchChange(event.target.checked)} />句读前关联本书原文<small>仅已建索引；裁剪选文发送至向量服务，不回注当前段落</small></label>}
      {externalPermissions && onExternalPermissionsChange && <ExternalPermissionsMenu permissions={externalPermissions} onChange={onExternalPermissionsChange} disabled={disabled} />}
      <label className={styles.field}>思考强度<select aria-label="选择思考强度" value={activeReasoning} disabled={disabled} onChange={event => changeReasoning(event.target.value as ReasoningEffort)}>
        {REASONING_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>}
  </div>;
}
