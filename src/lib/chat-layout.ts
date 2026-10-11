export function maxChatWidth(width: number, collapsed = false, navigationWidth?: number): number {
  // WHY：保留足够阅读视口，但不再把右栏锁定在近乎 390px 的窄区间。
  return Math.min(900, width - (width > 960 && collapsed ? 44 : width > 960 ? (navigationWidth ?? (width > 1180 ? 220 : 190)) : 0) - 280);
}

export function maxNavWidth(width: number, assistantHidden = false): number {
  // WHY：目录最多520px，始终留出正文280px和聊天最小300px；目录拖宽时由聊天分隔器同步夹紧，不能把右栏推出视口。
  return Math.max(160, Math.min(520, width - 280 - (assistantHidden ? 0 : 300)));
}
