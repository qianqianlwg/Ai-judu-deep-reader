export const HISTORY_JUMP_EVENT = "reader-history-jump";

/** WHY：历史定位把目标放在聊天视窗约 20% 处，留出上下文；只跳转一次，后续滚动由用户控制。 */
export function revealHistoryTarget(node: HTMLElement, scroller: HTMLElement): void {
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  scroller.querySelectorAll('[data-history-target]').forEach(item => item.removeAttribute('data-history-target'));
  // WHY：移除旧标记后测量会刷新样式，同一条再次定位也能重新播放强调动效。
  const targetRect = node.getBoundingClientRect(), viewportRect = scroller.getBoundingClientRect();
  const height = scroller.clientHeight || viewportRect.height;
  const desired = scroller.scrollTop + targetRect.top - viewportRect.top - scroller.clientTop - height * 0.2;
  const top = Math.max(0, Math.min(desired, Math.max(0, scroller.scrollHeight - height)));
  node.dataset.historyTarget = "true"; node.tabIndex = -1;
  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth";
  // WHY：先明确暂停自动跟随，避免平滑滚动尚未产生 scroll 事件时被聊天增量拉回最新消息。
  scroller.dispatchEvent(new Event(HISTORY_JUMP_EVENT));
  if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top, behavior });
  else scroller.scrollTop = top;
  // WHY：平滑滚动初始位置仍可能触底；此时伪造 scroll 会重新启用跟随并把目标拉回底部，等待浏览器真实事件。
  node.focus({ preventScroll: true });
}
