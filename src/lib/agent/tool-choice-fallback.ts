import { readProviderFailure } from "./provider-failure";

export type ReadingToolChoice = "required" | "auto" | "none";

function rejectsForcedToolChoice(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    const failure = readProviderFailure(current);
    const message = current.message + " " + (failure?.message ?? "");
    if (failure?.httpStatus === 400 && /tool_choice/iu.test(message)
      && /only/iu.test(message) && /auto/iu.test(message) && /none/iu.test(message)) return true;
    current = current.cause;
  }
  return false;
}

export function createToolChoiceFallback(options: { signal: AbortSignal; onFallback: () => void }) {
  // WHY：能力只在本轮同一模型中记忆，不按模型名称猜测，也不让切换模型继承旧网关限制。
  let autoOnly = false;
  return async function run<T>(choice: ReadingToolChoice, invoke: (choice: ReadingToolChoice) => T | Promise<T>): Promise<T> {
    options.signal.throwIfAborted();
    const effective = choice === "required" && autoOnly ? "auto" : choice;
    try { return await invoke(effective); }
    catch (error: unknown) {
      options.signal.throwIfAborted();
      // WHY：仅明确的工具选择协议400允许重试；认证、网络、限流和其他参数错误保持原始失败。
      if (effective !== "required" || !rejectsForcedToolChoice(error)) throw error;
      autoOnly = true;
      options.onFallback();
      // WHY：只改选择策略，工具、消息和Agent提交核验保持不变；auto失败直接上抛，不无限降级。
      return invoke("auto");
    }
  };
}
