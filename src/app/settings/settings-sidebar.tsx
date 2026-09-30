"use client";

import { useMemo, type ChangeEvent } from "react";
import styles from "./settings.module.css";

export type SettingsSectionId = "appearance" | "reading" | "context" | "speech" | "ai" | "search";

export const SETTINGS_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<{ id: SettingsSectionId; label: string; hint: string; icon: string }> }> = [
  {
    label: "个人",
    items: [
      { id: "appearance", label: "外观", hint: "主题与界面颜色", icon: "sun" },
      { id: "reading", label: "阅读", hint: "正文排版与句读", icon: "book" },
    ],
  },
  {
    label: "AI 与服务",
    items: [
      { id: "ai", label: "AI 句读", hint: "模型与连接", icon: "spark" },
      { id: "speech", label: "语音朗读", hint: "音色与播放", icon: "voice" },
      { id: "context", label: "上下文", hint: "记忆与 Token 预算", icon: "layers" },
      { id: "search", label: "语义搜索", hint: "向量索引与检索", icon: "search" },
    ],
  },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z",
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H12v17h5.5A2.5 2.5 0 0 1 20 22V5.5Z",
    spark: "m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Zm7 13 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z",
    voice: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3m-3 0h6",
    layers: "M12 3 3 7.5 12 12l9-4.5L12 3Zm-9 9 9 4.5 9-4.5M3 16.5 12 21l9-4.5",
    search: "m20 20-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  };
  return <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.book} /></svg>;
}

export interface SettingsSidebarProps {
  activeSection: SettingsSectionId;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (section: SettingsSectionId) => void;
}

export function SettingsSidebar({ activeSection, query, onQueryChange, onSelect }: SettingsSidebarProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = useMemo(() => SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !normalizedQuery || `${item.label} ${item.hint}`.toLocaleLowerCase().includes(normalizedQuery)),
  })).filter((group) => group.items.length > 0), [normalizedQuery]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.currentTarget.value);
  return <aside className={styles.sidebar} aria-label="设置导航">
    <header className={styles.sidebarHeader}>
      <div className={styles.sidebarTitleRow}><span className={styles.sidebarMark} aria-hidden="true">句</span><h2>设置</h2></div>
      <label className={styles.searchBox}>
        <NavIcon name="search" />
        <input type="search" value={query} onChange={handleChange} placeholder="搜索" aria-label="搜索设置" />
        {query && <button type="button" aria-label="清除设置搜索" onClick={() => onQueryChange("")}>×</button>}
      </label>
    </header>
    <nav className={styles.settingsNav} aria-label="设置分类">
      {groups.map((group) => <div className={styles.settingsGroup} key={group.label}>
        <p className={styles.groupLabel}>{group.label}</p>
        {group.items.map((item) => <button type="button" key={item.id} className={styles.settingsNavItem + (activeSection === item.id ? " " + styles.settingsNavItemActive : "")} aria-current={activeSection === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
          <NavIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.hint}</small></span>
        </button>)}
      </div>)}
      {!groups.length && <p className={styles.noResults}>没有匹配的设置</p>}
    </nav>
    <footer className={styles.sidebarFooter}><span className={styles.statusDot} aria-hidden="true" />偏好设置保存在本机</footer>
  </aside>;
}
