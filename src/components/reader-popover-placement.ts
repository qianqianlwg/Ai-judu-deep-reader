export type PopoverBounds = { left: number; right: number; top: number; bottom: number };
type Space = PopoverBounds & { placement: string };
const GAP = 12;

// WHY：句子避让只决定 UI 几何；空间不足时缩短卡片并内部滚动，绝不把卡片夹回正在读的句子上。
export function placeOutsideSentence(input: {
  bounds: PopoverBounds; viewport: PopoverBounds; anchor: PopoverBounds;
  avoid: readonly PopoverBounds[]; width: number; height: number;
}): { left: number; top: number; maxWidth: number; maxHeight: number; placement: string } | null {
  const visible = input.avoid.filter(r => r.right > input.viewport.left && r.left < input.viewport.right && r.bottom > input.viewport.top && r.top < input.viewport.bottom);
  if (!visible.length) return null;
  const protectedArea = {
    left: Math.min(...visible.map(r => r.left)), right: Math.max(...visible.map(r => r.right)),
    top: Math.min(...visible.map(r => r.top)), bottom: Math.max(...visible.map(r => r.bottom)),
  };
  const spaces = (bounds: PopoverBounds): Space[] => [
    { ...bounds, left: Math.max(bounds.left, protectedArea.right + GAP), placement: 'sentence-right' },
    { ...bounds, right: Math.min(bounds.right, protectedArea.left - GAP), placement: 'sentence-left' },
    { ...bounds, top: Math.max(bounds.top, protectedArea.bottom + GAP), placement: 'sentence-below' },
    { ...bounds, bottom: Math.min(bounds.bottom, protectedArea.top - GAP), placement: 'sentence-above' },
  ].filter(r => r.right > r.left && r.bottom > r.top);
  const readerSpaces = spaces(input.bounds);
  const outer = spaces({ left: input.viewport.left + GAP, right: input.viewport.right - GAP, top: input.viewport.top + GAP, bottom: input.viewport.bottom - GAP });
  const fits = (r: Space) => r.right-r.left >= input.width && r.bottom-r.top >= input.height;
  const readable = (r: Space) => r.right-r.left >= Math.min(180,input.width) && r.bottom-r.top >= 64;
  const largest = (items: Space[]) => [...items].sort((a,b) => Math.min(input.width,b.right-b.left)*Math.min(input.height,b.bottom-b.top)-Math.min(input.width,a.right-a.left)*Math.min(input.height,a.bottom-a.top))[0];
  // WHY：正文栏内优先；只有栏内没有可阅读空间，才用窗口外侧留白，仍不能与当前句子相交。
  const space = readerSpaces.find(fits) ?? largest(readerSpaces.filter(readable)) ?? outer.find(fits) ?? largest(outer.filter(readable));
  if (!space) return null;
  const maxWidth = Math.min(input.width,space.right-space.left), maxHeight = Math.min(input.height,space.bottom-space.top);
  const clamp = (value: number,min: number,max: number) => Math.max(min,Math.min(value,max));
  return { left: clamp(input.anchor.left,space.left,space.right-maxWidth), top: clamp(input.anchor.top,space.top,space.bottom-maxHeight), maxWidth, maxHeight, placement: space.placement };
}
