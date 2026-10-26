import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// WHY：标注模块同时被浏览器与服务端使用，保留 SHA-256 UTF-8 结果且不引入 Node 专属模块。
export function hashText(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
