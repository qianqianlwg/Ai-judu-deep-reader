export const UI_TEXT_SIZE_KEY = "judu:uiTextSize:v1";
export const DEFAULT_UI_TEXT_SIZE = 13;
export const UI_TEXT_SIZE_MIN = 11;
export const UI_TEXT_SIZE_MAX = 20;
export function normalizeUiTextSize(value: unknown): number {
  const size = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(size) && size >= UI_TEXT_SIZE_MIN && size <= UI_TEXT_SIZE_MAX ? size : DEFAULT_UI_TEXT_SIZE;
}
export function applyUiTextSize(target: HTMLElement, value: unknown): number {
  const size = normalizeUiTextSize(value);
  target.style.setProperty("--ui-text-size", `${size}px`);
  target.style.setProperty("--ui-small-size", `${Math.max(10, size - 2)}px`);
  target.style.setProperty("--ui-heading-size", `${Math.round(size * 1.4)}px`);
  return size;
}
export function uiTextSizeBootstrapScript(): string {
  // WHY：根布局仍是持久布局，首屏在绘制前读取非正文偏好；正文排版不共享此变量。
  return `(()=>{try{const n=Number(localStorage.getItem(${JSON.stringify(UI_TEXT_SIZE_KEY)}));const size=Number.isInteger(n)&&n>=${UI_TEXT_SIZE_MIN}&&n<=${UI_TEXT_SIZE_MAX}?n:${DEFAULT_UI_TEXT_SIZE};const root=document.documentElement;root.style.setProperty('--ui-text-size',size+'px');root.style.setProperty('--ui-small-size',Math.max(10,size-2)+'px');root.style.setProperty('--ui-heading-size',Math.round(size*1.4)+'px')}catch(error){console.warn('读取界面字号偏好失败',error)}})();`;
}
