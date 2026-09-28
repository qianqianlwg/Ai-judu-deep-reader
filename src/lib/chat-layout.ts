export function maxChatWidth(width: number, collapsed = false): number {
  // WHY：保留足够阅读视口，但不再把右栏锁定在近乎 390px 的窄区间。
  return Math.min(900, width - (width > 960 && collapsed ? 44 : width > 1180 ? 220 : width > 960 ? 190 : 0) - 280);
}
