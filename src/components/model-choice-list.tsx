"use client";

import styles from "./model-choice-list.module.css";
import type { ModelChoice } from "@/lib/model-choices";

type Props = { choices: readonly ModelChoice[]; onChange: (choices: ModelChoice[]) => void; disabled?: boolean };
const COPY = { title: "\u6a21\u578b\u5217\u8868", add: "\u6dfb\u52a0\u81ea\u5b9a\u4e49\u6a21\u578b", enabled: "\u5df2\u542f\u7528", disabled: "\u5df2\u505c\u7528", empty: "\u8fd8\u6ca1\u6709\u6a21\u578b\uff0c\u6dfb\u52a0\u540e\u4f1a\u5728\u5bf9\u8bdd\u4e2d\u663e\u793a", placeholder: "\u8f93\u5165\u6a21\u578b\u540d\u79f0" } as const;
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>; }
export function ModelChoiceList({ choices, onChange, disabled = false }: Props) {
  function update(index: number, patch: Partial<ModelChoice>) { onChange(choices.map((choice, itemIndex) => itemIndex === index ? { ...choice, ...patch } : { ...choice })); }
  const enabledCount = choices.filter(choice => choice.enabled && choice.model.trim()).length;
  return <section className={styles.root} aria-label={COPY.title}>
    <header className={styles.header}><strong>{COPY.title}</strong><span>{enabledCount} / {choices.length} {COPY.enabled}</span></header>
    {choices.length === 0 && <p className={styles.empty}>{COPY.empty}</p>}
    <div className={styles.list}>
      {choices.map((choice, index) => <div className={styles.row} data-model-row key={index}>
        <input className={styles.name} aria-label={`Model name ${index + 1}`} value={choice.model} disabled={disabled} placeholder={COPY.placeholder} onChange={event => update(index, { model: event.target.value })} />
        <button className={styles.remove} type="button" aria-label={`Remove model ${index + 1}`} disabled={disabled} onClick={() => onChange(choices.filter((_, itemIndex) => itemIndex !== index))}><TrashIcon /></button>
        <label className={styles.toggle} aria-label={`Enable model ${index + 1}`} title={choice.enabled ? COPY.enabled : COPY.disabled}>
          <input type="checkbox" aria-label={`Enable model ${index + 1}`} checked={choice.enabled} disabled={disabled} onChange={event => update(index, { enabled: event.target.checked })} />
          <span className={styles.switch} aria-hidden="true" />
        </label>
      </div>)}
    </div>
    <button className={styles.add} data-testid="add-model" type="button" disabled={disabled || choices.length >= 50} onClick={() => onChange([...choices.map(choice => ({ ...choice })), { model: "", enabled: true }])}>+ {COPY.add}</button>
  </section>;
}
