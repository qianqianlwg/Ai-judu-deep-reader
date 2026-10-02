export type PopoverBounds = { left: number; right: number; top: number; bottom: number };
const GAP = 12;

// WHY：概念卡只跟随被点击词位：默认正下方，底部放不下时翻到上方；不再寻找正文侧边或聊天栏。
export function placeBelowWord(input: {
  bounds: PopoverBounds; anchor: PopoverBounds; width: number; height: number;
}): { left: number; top: number; maxWidth: number; maxHeight: number; placement: 'word-below' | 'word-above' } | null {
  const { bounds, anchor } = input;
  const maxWidth = Math.min(input.width, bounds.right - bounds.left);
  const below = Math.max(0, bounds.bottom - anchor.bottom - GAP);
  const above = Math.max(0, anchor.top - GAP - bounds.top);
  // WHY：长定义两边都放不下时取空间较大的一侧并内部滚动，仍紧贴词位而不是夹回词上。
  const useBelow = below >= input.height || (above < input.height && below >= above);
  const maxHeight = Math.min(input.height, useBelow ? below : above);
  if (maxWidth <= 0 || maxHeight < Math.min(64, input.height)) return null;
  return {
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - maxWidth)),
    top: useBelow ? anchor.bottom + GAP : anchor.top - GAP - maxHeight,
    maxWidth, maxHeight, placement: useBelow ? 'word-below' : 'word-above',
  };
}
