import { SpeechError } from "./speech";

const MAX_EVENT_BYTES = 2_000_000;
const MAX_AUDIO_BYTES = 24_000_000;
function audioEvent(event: string): Uint8Array | "done" | undefined {
  const data = event.split(/\r?\n/u).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
  if (!data.trim()) return;
  if (data.trim() === "[DONE]") return "done";
  let value: unknown;
  try { value = JSON.parse(data); }
  catch { throw new SpeechError("语音流包含无效数据，请重试。", 502); }
  if (!value || typeof value !== "object") throw new SpeechError("语音流响应格式无效。", 502);
  if ("error" in value) throw new SpeechError("语音合成中断，请稍后重试。", 502);
  if (!("choices" in value) || !Array.isArray(value.choices)) return;
  const choice: unknown = value.choices[0];
  if (!choice || typeof choice !== "object" || !("delta" in choice)) return;
  const delta = choice.delta;
  if (!delta || typeof delta !== "object" || !("audio" in delta) || delta.audio === null) return;
  const audio = delta.audio;
  if (!audio || typeof audio !== "object" || !("data" in audio) || typeof audio.data !== "string") throw new SpeechError("语音流没有合法音频数据。", 502);
  if (audio.data === "") return;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(audio.data) || audio.data.length % 4 !== 0) throw new SpeechError("语音流音频编码无效。", 502);
  return Uint8Array.from(Buffer.from(audio.data, "base64"));
}
export function decodeSpeechStream(body: ReadableStream<Uint8Array>, abort: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "", ended = false, total = 0, cancelled = false;
  const frames: Uint8Array[] = [];
  function parse(final = false) {
    while (true) {
      const delimiter = /\r?\n\r?\n/u.exec(pending);
      if (!delimiter && !final) break;
      const event = delimiter ? pending.slice(0, delimiter.index) : pending;
      pending = delimiter ? pending.slice(delimiter.index + delimiter[0].length) : "";
      if (event.length > MAX_EVENT_BYTES) throw new SpeechError("语音流数据过大。", 502);
      const decoded = audioEvent(event);
      if (decoded === "done") { ended = true; break; }
      if (decoded) { total += decoded.byteLength; if (total > MAX_AUDIO_BYTES) throw new SpeechError("语音流音频过长，请缩短选文。", 502); frames.push(decoded); }
      if (!delimiter) break;
    }
    if (pending.length > MAX_EVENT_BYTES) throw new SpeechError("语音流数据过大。", 502);
  }
  async function cancel() { cancelled = true; abort(); await reader.cancel(); }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!frames.length && !ended) {
          const chunk = await reader.read();
          if (cancelled) return;
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          parse(chunk.done);
          if (chunk.done) ended = true;
        }
        // WHY：收到一帧就下发一帧，不等待上游完成；ReadableStream pull 同时保留客户端背压。
        const next = frames.shift();
        if (next) controller.enqueue(next);
        else if (!total) throw new SpeechError("语音服务没有返回音频，请重试。", 502);
        else { await reader.cancel(); controller.close(); }
      } catch (error: unknown) {
        if (cancelled) return;
        console.error("语音流读取失败", { name: error instanceof Error ? error.name : "UnknownError" });
        controller.error(error instanceof SpeechError ? error : new SpeechError("语音连接中断，请重试。", 502));
        try { await cancel(); } catch { console.error("取消上游语音流失败"); }
      }
    },
    async cancel() { await cancel(); },
  });
}
