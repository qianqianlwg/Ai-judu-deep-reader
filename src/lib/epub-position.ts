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


export type ConvertedPositionIdentity = {
  sourceHash: string;
  fileHash: string;
  converterVersion: "umd-epub-v1";
};
export type ConvertedPosition = ConvertedPositionIdentity & {
  version: 1;
  kind: "umd-epub";
  cfi: string;
  anchor: ReadingAnchor | null;
};

// WHY：派生 EPUB 的 CFI 属于转换产物，不能覆盖或回退读取原版位置键。
export function convertedPositionKey(editionId: string): string {
  return "judu:converted-position:" + editionId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isHash(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/iu.test(value);
}
function isConvertedIdentity(value: unknown): value is ConvertedPositionIdentity & Record<string, unknown> {
  return isRecord(value) && isHash(value.sourceHash) && isHash(value.fileHash)
    && value.converterVersion === "umd-epub-v1";
}
function hasInvalidCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) return true;
  }
  return false;
}
function isConvertedAnchor(value: unknown): value is ReadingAnchor | null {
  if (value === null) return true;
  return isRecord(value) && Object.keys(value).length === 2
    && typeof value.paragraphId === "string" && value.paragraphId.trim().length > 0
    && value.paragraphId.length <= 1024 && !hasInvalidCharacters(value.paragraphId)
    && typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0;
}

function isConvertedCfi(value: unknown): value is string {
  // WHY：与既有 Foliate isCFI 一样只检查封装，不自创范围/空间/断言语法限制。
  // 有界且非空不代表能定位；reader 仍须用当前转换书的 resolveCFI 复核。
  return typeof value === "string" && value.length <= 8192
    && /^epubcfi\((.+)\)$/u.exec(value)?.[0] === value;
}

export function readConvertedPosition(raw: string | null, identity: ConvertedPositionIdentity): ConvertedPosition | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isConvertedIdentity(identity) || !isConvertedIdentity(value)) return null;
    // WHY：双哈希与转换器须逐项原样匹配；同一原件重新生成的 EPUB 也不能复用旧 CFI。
    if (value.sourceHash !== identity.sourceHash || value.fileHash !== identity.fileHash
      || value.converterVersion !== identity.converterVersion || value.version !== 1 || value.kind !== "umd-epub") return null;
    const fields = ["version", "kind", "sourceHash", "fileHash", "converterVersion", "cfi", "anchor"];
    if (Object.keys(value).some(key => !fields.includes(key)) || !isConvertedCfi(value.cfi) || !isConvertedAnchor(value.anchor)) return null;
    return {
      version: 1, kind: "umd-epub", sourceHash: value.sourceHash, fileHash: value.fileHash,
      converterVersion: value.converterVersion, cfi: value.cfi,
      anchor: value.anchor === null ? null : { paragraphId: value.anchor.paragraphId, offset: value.anchor.offset },
    };
  } catch (cause: unknown) {
    console.warn("转换版阅读位置损坏，改用精读锚点", cause);
    return null;
  }
}
