import { createAgent, createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import type { ProviderConfig, ProviderMessage } from "../ai-provider";
import { isRecord, type ChatEvent, type ToolActivity } from "../chat-stream";
import { accumulateUsage, estimatedUsage, estimateTextTokens, type TokenUsage } from "../token-usage";
import { createReadingModel } from "./model";
import { readingToolSchemaText } from "./schemas";
import { createReadingTools, type ReadingToolDependencies } from "./tools";
import { logAgentEvent } from "./logger";
import { diagnoseToolException } from "./diagnostics";
import { countReadingCharacters } from "../reading-detail";

export class ReadingAgentError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "ReadingAgentError"; } }
export function readingAgentFailure(error: unknown): { code: string; message: string } | undefined {
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if (current instanceof ReadingAgentError) return { code: current.code, message: current.message };
    if (current.name === "GraphRecursionError") return { code: "tool_limit", message: "本轮工具循环达到上限，请提出更具体的问题后重新生成" };
    // WHY：LangChain 中间件会包装异常；只解包自己的可公开错误，供应商原始错误不返回页面。
    current = current.cause;
  }
}
export type ToolRun = { id: string; name: string; input: unknown; output: unknown; status: "completed" | "error" };
export type ReadingAgentOptions = {
  config: ProviderConfig; systemPrompt: string; messages: ProviderMessage[];
  maxOutputTokens: number; contextWindow: number; signal: AbortSignal;
  initialUsage?: TokenUsage;
  maxAnswerCharacters?: number;
  tools: ReadingToolDependencies;
  emit: (event: ChatEvent) => void;
  audit: (run: ToolRun) => Promise<void>;
};
function visibleText(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  // WHY：工具参数、思考块和签名不属于聊天正文，仅转发 text 块。
  return value.content.flatMap(block => isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("");
}
function toolResult(value: unknown): unknown {
  if (!isRecord(value) || typeof value.content !== "string") return value;
  try { return JSON.parse(value.content) as unknown; }
  catch (error: unknown) { console.warn("工具返回了非结构化结果", error instanceof Error ? error.name : "UnknownError"); return { ok: false, error: value.content }; }
}
function providerUsage(value: unknown) {
  if (!isRecord(value)) return;
  const usage = value.usage_metadata;
  if (!isRecord(usage) || ![usage.input_tokens, usage.output_tokens, usage.total_tokens].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return;
  const details = isRecord(usage.input_token_details) ? usage.input_token_details : undefined;
  return { input_tokens: usage.input_tokens as number, output_tokens: usage.output_tokens as number, total_tokens: usage.total_tokens as number,
    ...(typeof details?.cache_read === "number" ? { input_token_details: { cache_read: details.cache_read } } : {}) };
}
export async function runReadingAgent(options: ReadingAgentOptions): Promise<{ text: string; usage: TokenUsage }> {
  const { signal, emit } = options;
  let text = "";
  let usage: TokenUsage | undefined = options.initialUsage;
  let stepInput = options.systemPrompt + JSON.stringify(options.messages);
  let stepOutput = "";
  let stepHasText = false;
  let finishedModel = false;
  let toolCount = 0;
  let lastPreview = 0;
  const announcedTools = new Set<string>();
  const publishEstimate = () => {
    const estimate = estimatedUsage(stepInput, stepOutput, options.contextWindow);
    emit({ type: "usage", usage: { ...estimate, inputTokens: (usage?.inputTokens ?? 0) + estimate.inputTokens, outputTokens: (usage?.outputTokens ?? 0) + estimate.outputTokens, totalTokens: (usage?.totalTokens ?? 0) + estimate.totalTokens } });
  };
  const tools = [...createReadingTools(options.tools)].filter(tool => options.tools.selectedText.trim() || tool.name !== "save_reading_analysis");
  const schemaText = readingToolSchemaText(Boolean(options.tools.selectedText.trim()));
  const middleware = createMiddleware({
    name: "ReadingToolAudit",
    beforeModel(state) {
      // WHY：工具返回也占窗口；每个模型步骤都检查预算，不等上游超限后才报错。
      const estimatedInput = estimateTextTokens(options.systemPrompt + JSON.stringify(state.messages) + schemaText);
      if (estimatedInput > options.contextWindow - options.maxOutputTokens) throw new ReadingAgentError("context_limit", "本轮选文、历史和工具资料超过上下文预算，请提高输入 Token 上限或新建会话");
    },
    wrapToolCall: async (request, handler) => {
      signal.throwIfAborted();
      if (++toolCount > 20) throw new ReadingAgentError("tool_limit", "本轮工具调用过多，请缩小问题范围后重试");
      const id = request.toolCall.id ?? crypto.randomUUID();
      const name = request.toolCall.name;
      emit({ type: "tool", tool: { id, name, status: "running" } });
      logAgentEvent("info", "tool_started", { id, name, inputKeys: isRecord(request.toolCall.args) ? Object.keys(request.toolCall.args) : [] });
      let result;
      try { result = await handler(request); }
      catch (error: unknown) {
        signal.throwIfAborted();
        const diagnostic = diagnoseToolException(name, request.toolCall.args);
        logAgentEvent("error", "tool_exception", { messageId: options.tools.messageId, id, name, ...diagnostic, errorName: error instanceof Error ? error.name : "UnknownError" });
        result = new ToolMessage({ tool_call_id: id, status: "error", content: JSON.stringify(diagnostic) });
      }
      signal.throwIfAborted();
      const output = toolResult(result);
      const status = isRecord(output) && output.ok === false ? "error" : "completed";
      logAgentEvent(status === "error" ? "warn" : "info", "tool_finished", { id, name, messageId: options.tools.messageId, status, code: isRecord(output) && typeof output.code === "string" ? output.code : undefined });
      // WHY：审计失败不能伪装为工具成功，交给上层请求保存失败状态。
      try { await options.audit({ id, name, input: request.toolCall.args, output, status }); } catch (error: unknown) { logAgentEvent("error", "tool_audit_failed", { id, name, errorName: error instanceof Error ? error.name : "UnknownError", code: "tool_audit_failed" }); throw error; }
      const activity: ToolActivity = { id, name, status, result: output };
      emit({ type: "tool", tool: activity });
      return result;
    },
  });
  const agent = createAgent({ model: createReadingModel(options.config, options.maxOutputTokens), tools, systemPrompt: options.systemPrompt, middleware: [middleware] });
  const finishes = new Map<string, string>();
  const stream = agent.streamEvents({ messages: options.messages }, { version: "v2", signal, recursionLimit: 24,
    callbacks: [{ handleLLMEnd(result, runId) {
      // WHY：LangChain 的 token 事件不包含 OpenAI generationInfo，完成原因必须从 SDK 回调读取。
      const finish: unknown = result.generations[0]?.[0]?.generationInfo?.finish_reason;
      if (typeof finish === "string") finishes.set(runId, finish);
    } }],
  });
  for await (const event of stream) {
    signal.throwIfAborted();
    if (event.event === "on_chat_model_start") {
      stepInput = JSON.stringify(event.data.input) + schemaText;
      stepOutput = "";
      stepHasText = false;
      finishedModel = false;
      publishEstimate();
      lastPreview = Date.now();
    } else if (event.event === "on_chat_model_stream") {
      const chunk: unknown = event.data.chunk;
      if (isRecord(chunk) && Array.isArray(chunk.tool_call_chunks)) {
        for (const call of chunk.tool_call_chunks) {
          if (isRecord(call) && typeof call.id === "string" && typeof call.name === "string" && call.name && !announcedTools.has(call.id)) {
            announcedTools.add(call.id);
            emit({ type: "tool", tool: { id: call.id, name: call.name, status: "running", result: "正在准备工具参数…" } });
          }
        }
      }
      const delta = visibleText(chunk);
      if (delta) {
        // WHY：Agent 多步说明不能把后一步 Markdown 标题粘到前一步句末，原始文字不做去重或改写。
        if (!stepHasText && text && !text.endsWith("\n\n")) { text += "\n\n"; emit({ type: "raw_delta", text: "\n\n" }); }
        if (options.maxAnswerCharacters !== undefined && countReadingCharacters(text + delta) > options.maxAnswerCharacters) {
          logAgentEvent("warn", "answer_length_limit", { messageId: options.tools.messageId, actualCharacters: countReadingCharacters(text + delta), maxCharacters: options.maxAnswerCharacters });
          // WHY：阻止整篇答案继续失控，不把截断后的半篇伪装成完整成功；保留已收到文字供原位重试。
          throw new ReadingAgentError("answer_length_limit", "本次释读超过所选详细程度的字数上限，已停止生成，请重试。不会把过长答案标为完成。");
        }
        stepHasText = true; text += delta; stepOutput += delta; emit({ type: "raw_delta", text: delta }); if (Date.now() - lastPreview > 250) { publishEstimate(); lastPreview = Date.now(); } }
    } else if (event.event === "on_chat_model_end") {
      const output: unknown = event.data.output;
      const metadata = isRecord(output) && isRecord(output.response_metadata) ? output.response_metadata : {};
      const additional = isRecord(output) && isRecord(output.additional_kwargs) ? output.additional_kwargs : {};
      const finish = finishes.get(event.run_id) ?? metadata.finish_reason ?? metadata.stop_reason ?? additional.stop_reason;
      if (finish === "length" || finish === "max_tokens") throw new ReadingAgentError("output_limit", "回答达到输出上限，请提高最大输出 Token 后重试");
      if (finish === "content_filter" || finish === "refusal") throw new Error("模型未能完成本轮回答");
      finishedModel = typeof finish === "string" && finish.length > 0;
      const measured = providerUsage(output);
      if (measured) usage = accumulateUsage(usage, measured, options.contextWindow);
      else {
        const estimate = estimatedUsage(stepInput, stepOutput, options.contextWindow);
        usage = { ...estimate, inputTokens: (usage?.inputTokens ?? 0) + estimate.inputTokens, outputTokens: (usage?.outputTokens ?? 0) + estimate.outputTokens, totalTokens: (usage?.totalTokens ?? 0) + estimate.totalTokens };
      }
      emit({ type: "usage", usage });
    }
  }
  if (!finishedModel) throw new ReadingAgentError("interrupted", "模型流中断，未收到完成确认，请重试");
  if (!text.trim()) throw new ReadingAgentError("empty_output", "模型未返回正常聊天文本，请重试");
  return { text, usage: usage ?? estimatedUsage(stepInput, text, options.contextWindow) };
}
