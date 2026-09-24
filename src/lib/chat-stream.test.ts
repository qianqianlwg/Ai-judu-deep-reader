import { describe, expect, it } from "vitest";
import { applyChatEvent, decodeChatEvent, streamingPreview, type ChatMessage } from "./chat-stream";
import { SseDecoder } from "./sse";

describe("chat stream", () => {
  it("updates one assistant message", () => {
    const messages = [{ id: "a", role: "assistant" as const, kind: "chat" as const, content: "", status: "streaming" as const }];
    const next = applyChatEvent(messages, "a", { type: "raw_delta", text: "hello" });
    expect(next).toHaveLength(1);
    expect(next[0].content).toBe("hello");
    expect(next[0].id).toBe("a");
  });
  it("handles CRLF SSE chunks", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(new TextEncoder().encode("event: raw_delta\r\ndata: {\"text\":\"hello\"}\r"))).toEqual([]);
    const events = decoder.push(new TextEncoder().encode("\n\r\n"));
    expect(events).toEqual([{ event: "raw_delta", data: "{\"text\":\"hello\"}" }]);
    expect(decodeChatEvent(events[0])).toEqual({ type: "raw_delta", text: "hello" });
  });
  it("shows a readable summary preview while analysis JSON streams", () => {
    expect(streamingPreview('{"summary":"This paragraph discusses self-consciousness', "analysis")).toBe("This paragraph discusses self-consciousness");
    expect(streamingPreview('{"summary":"x"}', "chat")).toContain("summary");
  });
});

it("并行工具乱序完成时保持首次出现顺序，重复事件不追加卡片",()=>{let messages: ChatMessage[]= [{id:'a',role:'assistant' as const,content:''}];for(const id of ['first','second'])messages=applyChatEvent(messages,'a',{type:'tool',tool:{id,name:'search_book',status:'running'}});for(const id of ['first','second','first'])messages=applyChatEvent(messages,'a',{type:'tool',tool:{id,name:'search_book',status:'completed'}});expect(messages[0].tools?.map(t=>t.id)).toEqual(['first','second']);});
