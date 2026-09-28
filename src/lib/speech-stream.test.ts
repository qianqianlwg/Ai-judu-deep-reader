import { afterEach, expect, it, vi } from "vitest";
import { decodeSpeechStream } from "./speech-stream";
const encoder = new TextEncoder();
const event = (bytes: number[]) => "data: " + JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(bytes).toString("base64") } } }] }) + "\n\n";
afterEach(() => vi.restoreAllMocks());
it("首帧立即返回，不等待上游结束，后续帧按顺序转发", async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } });
  const reader = decodeSpeechStream(body, vi.fn()).getReader();
  upstream.enqueue(encoder.encode(event([1, 2, 3, 4])));
  expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1, 2, 3, 4]) });
  upstream.enqueue(encoder.encode(event([5, 6]) + "data: [DONE]\n\n"));
  expect((await reader.read()).value).toEqual(new Uint8Array([5, 6])); expect((await reader.read()).done).toBe(true);
});
it("跨网络包拆开的 JSON、CRLF 和多事件保持音频字节完整", async () => {
  const source = (": ping\n\n" + event([0, 127, 128, 255]) + "data: [DONE]\n\n").replace(/\n/gu, "\r\n");
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const char of source) controller.enqueue(encoder.encode(char)); controller.close(); } });
  const bytes = await new Response(decodeSpeechStream(body, vi.fn())).arrayBuffer(); expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0, 127, 128, 255]));
});
it("忽略统计与无音频 delta，支持尾部未带空行的事件", async () => {
  const source = 'data: {"choices":[]}\n\ndata: {"choices":[{"delta":{"content":""}}]}\n\n' + event([3, 4]).trimEnd();
  const body = new Response(source).body!;
  expect(new Uint8Array(await new Response(decodeSpeechStream(body, vi.fn())).arrayBuffer())).toEqual(new Uint8Array([3, 4]));
});
it("取消下游同时取消供应商请求和在途 reader", async () => {
  const abort = vi.fn(), cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }); const reader = decodeSpeechStream(body, abort).getReader();
  await reader.cancel(); expect(abort).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});
it.each(['data: invalid-json\n\n', 'data: {"error":{"message":"unit-key SECRET_TEXT"}}\n\n', 'data: [DONE]\n\n', 'data: {"choices":[{"delta":{"audio":{"data":"!invalid!"}}}]}\n\n'])("无效或空音频流报错且不泄露上游正文", async source => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reader = decodeSpeechStream(new Response(source).body!, vi.fn()).getReader();
  await expect(reader.read()).rejects.toMatchObject({ name: "SpeechError", status: 502 });
  expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("unit-key"));
});
