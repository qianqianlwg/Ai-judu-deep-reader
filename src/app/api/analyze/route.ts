import { NextRequest, NextResponse } from "next/server";
import { POST as streamAnalysis } from "./stream/route";
import { decodeChatEvent, type Analysis } from "@/lib/chat-stream";
import { SseDecoder } from "@/lib/sse";
import type { TokenUsage } from "@/lib/token-usage";
export const runtime = "nodejs";

// WHY：兼容非流式调用者，但共享同一个 Agent；不能保留另一条强迫 JSON 或伪造演示成功的路径。
export async function POST(request: NextRequest) {
  const response = await streamAnalysis(request);
  if (!response.ok || !response.body) return response;
  let content = "", threadId = "", analysisId = "", failure = "", completed = false;
  let result: Analysis | undefined;
  let usage: TokenUsage | undefined;
  const reader = response.body.getReader();
  const decoder = new SseDecoder();
  const consume = (events: ReturnType<SseDecoder["push"]>) => {
    for (const raw of events) {
      const event = decodeChatEvent(raw);
      if (!event) continue;
      if (event.type === "meta") { threadId = event.threadId; analysisId = event.messageId ?? ""; }
      else if (event.type === "raw_delta") content += event.text;
      else if (event.type === "structured") result = event.result;
      else if (event.type === "usage") usage = event.usage;
      else if (event.type === "error") failure = event.message;
      else if (event.type === "done") { content = event.content ?? content; completed = true; }
    }
  };
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) { consume(decoder.finish()); break; } consume(decoder.push(chunk.value)); }
  } catch (error: unknown) {
    console.error("读取 Agent 非流式结果失败", { name: error instanceof Error ? error.name : "UnknownError" });
    failure = "Agent 响应中断，请重试";
  } finally {
    try { await reader.cancel(); } catch (error: unknown) { console.error("释放 Agent 结果流失败", error); }
    reader.releaseLock();
  }
  const body = { analysisId, threadId, source: "agent", content, result, usage };
  return failure || !completed ? NextResponse.json({ ...body, error: failure || "未收到 Agent 完成确认" }, { status: 502 }) : NextResponse.json(body);
}
