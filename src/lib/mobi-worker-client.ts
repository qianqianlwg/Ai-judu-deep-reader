import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MobiContainerKind } from "./mobi-format";

export type MobiWorkerResult = { title: string; authors: string[]; chapters: { id: string; title: string; paragraphs: string[] }[] };
export type MobiWorkerInput = { bytes: Uint8Array; kind: MobiContainerKind; resourceDir: string };
export type MobiWorkerOptions = { signal?: AbortSignal; timeoutMs?: number };
const localRequire = createRequire(import.meta.url);
const MAX_CHARS = 20_000_000;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");

export function readMobiWorkerResult(value: unknown): MobiWorkerResult {
  if (!object(value) || typeof value.title !== "string" || value.title.length > 4096 || !Array.isArray(value.authors)
    || value.authors.length > 256 || !value.authors.every((author): author is string => typeof author === "string" && author.length <= 4096)
    || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 10_000) throw new Error("MOBI解析进程返回格式无效");
  let characters = value.title.length + value.authors.join("").length;
  const ids = new Set<string>();
  let paragraphCount = 0;
  const chapters = value.chapters.map((chapter: unknown) => {
    if (!object(chapter) || typeof chapter.id !== "string" || !chapter.id || chapter.id.length > 256 || ids.has(chapter.id)
      || typeof chapter.title !== "string" || chapter.title.length > 4096 || !Array.isArray(chapter.paragraphs) || chapter.paragraphs.length > 100_000 || !chapter.paragraphs.every((text): text is string => typeof text === "string")) throw new Error("MOBI解析进程章节无效");
    paragraphCount += chapter.paragraphs.length;
    if (paragraphCount > 100_000) throw new Error("MOBI解析进程段落数超限");
    characters += chapter.paragraphs.reduce((total, text) => total + text.length, 0) + chapter.title.length;
    if (characters > MAX_CHARS) throw new Error("MOBI解析进程输出超限");
    ids.add(chapter.id);
    return { id: chapter.id, title: chapter.title, paragraphs: chapter.paragraphs };
  });
  return { title: value.title, authors: value.authors, chapters };
}

/** 内部装配边界；调用方不得把书籍内容或上传文件名作为脚本/命令传入。 */
export function collectMobiWorker(child: ChildProcess, options: MobiWorkerOptions): Promise<MobiWorkerResult> {
  return new Promise((resolve, reject) => {
    let result: MobiWorkerResult | undefined, failure: Error | undefined, received = false;
    const terminate = (error: Error) => { failure ??= error; if (child.exitCode === null && child.signalCode === null) child.kill(); };
    const aborted = () => terminate(new Error("MOBI解析已取消"));
    const timer = setTimeout(() => terminate(new Error("MOBI解析超时，解析进程已终止")), options.timeoutMs ?? 15_000);
    child.on("error", error => terminate(error));
    child.on("message", (message: unknown) => {
      if (received) { terminate(new Error("MOBI解析进程重复响应")); return; }
      received = true;
      try {
        if (!object(message) || message.ok !== true) throw new Error("MOBI候选解析器失败：" + (object(message) && typeof message.error === "string" ? message.error.slice(0, 500) : "无效响应"));
        result = readMobiWorkerResult(message.result);
      } catch (cause: unknown) { terminate(cause instanceof Error ? cause : new Error("MOBI解析响应无效")); }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", aborted);
      // WHY：收到结果不等于进程已退出；必须等close后才允许父层删除临时目录，避免迟到文件写入。
      if (failure) reject(failure);
      else if (code !== 0 || signal || !result) reject(new Error("MOBI解析进程异常退出或未返回结果"));
      else resolve(result);
    });
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (options.signal?.aborted) aborted();
  });
}

export async function runMobiWorker(input: MobiWorkerInput, options: MobiWorkerOptions = {}): Promise<MobiWorkerResult> {
  if (options.signal?.aborted) throw new Error("MOBI解析已取消");
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)) throw new Error("MOBI解析超时配置无效");
  if (input.bytes.byteLength > 100 * 1024 * 1024) throw new Error("MOBI输入超限");
  const worker = fileURLToPath(new URL("./mobi-worker.mjs", import.meta.url));
  const parserPath = localRequire.resolve("@lingo-reader/mobi-parser");
  const nodeModules = path.resolve(parserPath, "../../../..");
  // WHY：不继承NODE_OPTIONS、模型密钥等环境；Node权限仅允许读依赖和写本次私有目录。并非完整OS/网络沙箱。
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) };
  const child = spawn(process.execPath, ["--max-old-space-size=192", "--permission", `--allow-fs-read=${worker}`,
    `--allow-fs-read=${fileURLToPath(new URL("./mobi-html.mjs", import.meta.url))}`, `--allow-fs-read=${fileURLToPath(new URL("../../vendor/mobi/", import.meta.url))}`, `--allow-fs-read=${nodeModules}`, `--allow-fs-read=${input.resourceDir}`, `--allow-fs-write=${input.resourceDir}`, worker], {
    cwd: input.resourceDir, env, windowsHide: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const pending = collectMobiWorker(child, options);
  try { child.send(input, error => { if (error) child.emit("error", error); }); }
  catch (cause: unknown) { child.emit("error", cause instanceof Error ? cause : new Error("MOBI进程通信失败")); }
  return pending;
}
