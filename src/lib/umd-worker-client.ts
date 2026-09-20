import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { UmdBook, UmdCover } from "./umd-parser";
import { UMD_LIMITS, UmdFormatError } from "./umd-container";

export type UmdWorkerOptions = { signal?: AbortSignal; timeoutMs?: number };
export type UmdIdentity = { sourceHash: string; sourceSize: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function invalid(): never { throw new UmdFormatError("解析进程响应无效或超限"); }
export function readUmdWorkerResult(value: unknown, identity: UmdIdentity): UmdBook {
  if (!object(value) || value.kind !== "text" || value.sourceHash !== identity.sourceHash || value.sourceSize !== identity.sourceSize
    || typeof value.title !== "string" || value.title.length > 4096 || typeof value.author !== "string" || value.author.length > 4096
    || typeof value.declaredBytes !== "number" || !Number.isSafeInteger(value.declaredBytes) || value.declaredBytes < 1 || value.declaredBytes > UMD_LIMITS.text
    || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > UMD_LIMITS.chapters) invalid();
  let offset = 0;
  const chapters = value.chapters.map((chapter: unknown) => {
    if (!object(chapter) || typeof chapter.title !== "string" || chapter.title.length > 256 || typeof chapter.text !== "string"
      || chapter.startByte !== offset || typeof chapter.endByte !== "number" || !Number.isSafeInteger(chapter.endByte)
      || chapter.endByte <= offset || chapter.endByte > Number(value.declaredBytes) || chapter.text.length * 2 !== chapter.endByte - offset) invalid();
    const result = { title: chapter.title, text: chapter.text, startByte: offset, endByte: chapter.endByte };
    offset = chapter.endByte; return result;
  });
  if (offset !== value.declaredBytes) invalid();
  let cover: UmdCover | undefined;
  if (value.cover !== undefined) {
    if (!object(value.cover) || !(value.cover.bytes instanceof Uint8Array) || !value.cover.bytes.byteLength
      || value.cover.bytes.byteLength > UMD_LIMITS.cover || (value.cover.mediaType !== "image/jpeg" && value.cover.mediaType !== "image/png")) invalid();
    cover = { bytes: Buffer.from(value.cover.bytes), mediaType: value.cover.mediaType };
  }
  return { kind: "text", title: value.title, author: value.author, ...identity, declaredBytes: value.declaredBytes, chapters, ...(cover ? { cover } : {}) };
}
export function collectUmdWorker(child: ChildProcess, identity: UmdIdentity, options: UmdWorkerOptions = {}): Promise<UmdBook> {
  return new Promise((resolve, reject) => {
    let result: UmdBook | undefined, failure: Error | undefined, received = false;
    const terminate = (error: Error) => { failure ??= error; if (child.exitCode === null && child.signalCode === null) child.kill(); };
    const abort = () => terminate(new UmdFormatError("解析已取消"));
    const timer = setTimeout(() => terminate(new UmdFormatError("解析超时，进程已终止")), options.timeoutMs ?? 15000);
    child.on("error", terminate);
    child.on("message", (message: unknown) => {
      if (received) { terminate(new UmdFormatError("解析进程重复响应")); return; } received = true;
      try {
        if (!object(message) || message.ok !== true) throw new UmdFormatError(object(message) && typeof message.error === "string" ? message.error.slice(0, 500) : "解析进程响应无效");
        result = readUmdWorkerResult(message.result, identity);
      } catch (cause: unknown) { terminate(cause instanceof Error ? cause : new UmdFormatError("响应无效")); }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      // WHY：收到IPC不等于进程完成，等待close，失败/超时/取消都不会留下继续解析的后台进程。
      if (failure) reject(failure);
      else if (code !== 0 || signal || !result) reject(new UmdFormatError("解析进程异常退出或未返回结果"));
      else resolve(result);
    });
    options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
  });
}

/** 供受控转换组合根调用，不由上传文件指定worker路径或环境变量。 */
export async function runUmdWorker(input: Uint8Array, options: UmdWorkerOptions = {}): Promise<UmdBook> {
  if (options.signal?.aborted) throw new UmdFormatError("解析已取消");
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)) throw new UmdFormatError("超时配置无效");
  if (!(input instanceof Uint8Array) || input.byteLength < 4 || input.byteLength > UMD_LIMITS.input) throw new UmdFormatError("输入大小无效");
  const bytes = Buffer.from(input), identity = { sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceSize: bytes.length };
  const worker = path.resolve(process.cwd(), "runtime/umd/worker.cjs");
  try { const file = await lstat(worker); if (!file.isFile() || file.isSymbolicLink()) throw new Error("不是普通运行时文件"); }
  catch (cause: unknown) { throw new UmdFormatError("运行时未就绪，请执行 npm run build:umd-worker", { cause }); }
  if (options.signal?.aborted) throw new UmdFormatError("解析已取消");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(["SystemRoot", "WINDIR"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) };
  // WHY：UMD解析只做内存转换，整个worker无文件写权限，不读data/src/node_modules，也不继承模型密钥。
  const child = spawn(process.execPath, ["--max-old-space-size=192", "--permission", `--allow-fs-read=${worker}`, worker], {
    cwd: path.dirname(worker), env, windowsHide: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const pending = collectUmdWorker(child, identity, options);
  try { child.send({ bytes }, error => { if (error) child.emit("error", error); }); }
  catch (cause: unknown) { child.emit("error", cause instanceof Error ? cause : new UmdFormatError("进程通信失败")); }
  return pending;
}
