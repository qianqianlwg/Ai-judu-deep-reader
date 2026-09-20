import { parseUmd } from "./umd-parser";

// WHY：仅固定父进程IPC入口；不接受命令、路径或第三方回调，不执行书籍内嵌内容。
process.once("message", async (message: unknown) => {
  try {
    if (!message || typeof message !== "object" || !("bytes" in message) || !(message.bytes instanceof Uint8Array)) throw new Error("UMD worker输入无效");
    const result = await parseUmd(message.bytes);
    process.send?.({ ok: true, result }, error => process.exit(error ? 1 : 0));
  } catch (cause: unknown) {
    const error = cause instanceof Error ? cause.message.slice(0, 500) : "UMD解析失败";
    process.send?.({ ok: false, error }, sendError => process.exit(sendError ? 1 : 0));
  }
});
