export type ReaderPane = "shelf" | "reading" | "chat";

export type CollapseButtonState = {
  expanded: boolean;
  label: string;
  symbol: "＋" | "−";
};

export function collapseButtonState(expanded: boolean, label: string): CollapseButtonState {
  return { expanded, label: expanded ? `折叠${label}` : `展开${label}`, symbol: expanded ? "−" : "＋" };
}

// WHY：三栏使用固定视口和独立滚动容器，避免正文翻页或聊天变长时推动整页滚动。
export function paneScrollPolicy(): Record<ReaderPane, "independent" | "fixed"> {
  return { shelf: "independent", reading: "fixed", chat: "independent" };
}
