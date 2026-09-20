import type { ReadingAnchor } from "./pagination";
export type OriginalPosition = { version: 1; originalHash: string; cfi: string; anchor: ReadingAnchor | null };
export function originalPositionKey(editionId: string): string { return "judu:original-position:" + editionId; }
export function readOriginalPosition(raw: string | null, originalHash: string): OriginalPosition | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("originalHash" in value) || value.originalHash !== originalHash || !("cfi" in value) || typeof value.cfi !== "string" || !value.cfi.startsWith("epubcfi(") || value.cfi.length > 8192 || !("anchor" in value)) return null;
    const anchor = value.anchor;
    if (anchor !== null && (!anchor || typeof anchor !== "object" || !("paragraphId" in anchor) || typeof anchor.paragraphId !== "string" || !("offset" in anchor) || typeof anchor.offset !== "number" || !Number.isSafeInteger(anchor.offset) || anchor.offset < 0)) return null;
    return {version:1,originalHash,cfi:value.cfi,anchor:anchor as ReadingAnchor | null};
  } catch (cause: unknown) { console.warn("原版阅读位置损坏，改用精读锚点",cause); return null; }
}
export function sameReadingAnchor(a:ReadingAnchor|null,b:ReadingAnchor|null):boolean { return a?.paragraphId===b?.paragraphId && a?.offset===b?.offset; }
