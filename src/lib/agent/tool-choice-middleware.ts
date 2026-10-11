import { createMiddleware } from "langchain";
import { createToolChoiceFallback } from "./tool-choice-fallback";

export function createToolChoiceMiddleware(options: { signal: AbortSignal; onFallback: () => void }) {
  const run = createToolChoiceFallback(options);
  return createMiddleware({
    name: "ReadingToolChoiceCompatibility",
    wrapModelCall: (request, handler) => {
      const choice = request.toolChoice;
      // WHY：兼容层只处理既有选择策略，不强制未指定策略的请求，也不猜测命名工具调用的能力。
      if (choice !== "required" && choice !== "auto" && choice !== "none") return handler(request);
      return run(choice, toolChoice => handler({ ...request, toolChoice }));
    },
  });
}
