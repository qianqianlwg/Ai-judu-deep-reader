export type StreamEvent = { event: string; data: string };
export function parseSseBlock(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}
export class SseDecoder {
  private decoder = new TextDecoder();
  private buffer = "";
  push(bytes: Uint8Array): StreamEvent[] {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    return this.drain(false);
  }
  finish(): StreamEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }
  private drain(final: boolean): StreamEvent[] {
    const events: StreamEvent[] = [];
    // WHY：在完整缓冲区内寻找边界，不能逐 chunk 替换 CRLF，否则恰好切在 CR/LF 间会丢帧。
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer))) {
      const parsed = parseSseBlock(this.buffer.slice(0, boundary.index));
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      if (parsed) events.push(parsed);
    }
    if (final && this.buffer.trim()) {
      const parsed = parseSseBlock(this.buffer);
      if (parsed) events.push(parsed);
      this.buffer = "";
    }
    return events;
  }
}
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new SseDecoder();
  let exhausted = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) { exhausted = true; break; }
      yield* decoder.push(part.value);
    }
    yield* decoder.finish();
  } finally {
    if (!exhausted) await reader.cancel();
    reader.releaseLock();
  }
}
