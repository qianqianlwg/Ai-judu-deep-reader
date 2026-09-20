import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { inspectMobiContainer } from "./mobi-format";
import { runMobiLayoutWorker, runMobiPreparedLayoutWorker, type MobiWorkerInput, type MobiWorkerOptions } from "./mobi-worker-client";
import type { MobiLayoutSnapshot } from "./mobi-layout-snapshot";

/** 布局候选组合根：保存资源/样式/链接证据；返回内容未净化，不作为公开下载或浏览器输入。 */
export async function parseMobiLayout(input: Uint8Array, options: MobiWorkerOptions = {}): Promise<MobiLayoutSnapshot> {
  return runLayout(input, options, runMobiLayoutWorker, result=>result);
}
/** 内部原版准备入口；章节净化/资源图/来源重投影都留在可终止worker，暂不公开资源。 */
export async function prepareMobiFileLayout(input:Uint8Array,options:MobiWorkerOptions={}) {
  return runLayout(input, options, runMobiPreparedLayoutWorker, result=>result.snapshot);
}
async function runLayout<T>(input:Uint8Array, options:MobiWorkerOptions,
  run:(input:MobiWorkerInput,options:MobiWorkerOptions)=>Promise<T>, snapshot:(value:T)=>MobiLayoutSnapshot):Promise<T> {
  if (!(input instanceof Uint8Array) || input.byteLength > 100 * 1024 * 1024) throw new Error("MOBI布局输入无效或超限");
  // WHY：先复制输入和核对容器/DRM，再等待IO；worker与父进程始终核验同一原件快照。
  const bytes = Buffer.from(input), header = inspectMobiContainer(bytes);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const directory = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-layout-"));
  let failure: unknown;
  try {
    const result = await run({ bytes, kind: header.kind, resourceDir: directory }, options);
    const identity = snapshot(result);
    if (identity.kind !== header.kind || identity.sourceHash !== sourceHash) throw new Error("MOBI布局来源身份与原件不一致");
    return result;
  } catch (cause: unknown) { failure = cause; throw cause; }
  finally {
    // WHY：收到布局必须先等worker退出；临时原始资源不对外发布，只有已复制的包内快照可离开此范围。
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-layout-")) throw new Error("MOBI布局清理路径越界");
    try { await rm(resolved, { recursive: true, force: true }); }
    catch (cause: unknown) { throw new AggregateError(failure ? [failure, cause] : [cause], "MOBI布局临时文件清理失败"); }
  }
}
