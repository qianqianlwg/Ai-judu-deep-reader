import { MAX_SPEECH_CHUNK, SpeechError } from "./speech";
import type { SpeechConfig } from "./speech-config";
import { decodeSpeechStream } from "./speech-stream";

export const MIMO_SPEECH_URL = "https://api.xiaomimimo.com/v1/chat/completions";
export function buildSpeechRequest(text: string, config: SpeechConfig) {
  if (!text.trim() || Array.from(text).length > MAX_SPEECH_CHUNK) throw new SpeechError(`每段朗读须为 1–${MAX_SPEECH_CHUNK} 字符。`);
  return { model: "mimo-v2.5-tts", stream: true,
    // WHY：正文必须放 assistant；流式音频指定 PCM16，避免 WAV 容器需要完整下载才能解码。
    messages: [{ role: "user", content: config.preferences.style }, { role: "assistant", content: text }],
    audio: { format: "pcm16", voice: config.preferences.voice } };
}
export async function synthesizeSpeech(text: string, config: SpeechConfig, fetcher: typeof fetch, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (!config.apiKey) throw new SpeechError("尚未配置语音密钥，请到设置 → 语音朗读填写 MiMo API Key。", 503);
  const body = buildSpeechRequest(text, config);
  const controller = new AbortController();
  let response: Response;
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    response = await fetcher(MIMO_SPEECH_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, controller.signal]) });
  } catch (error: unknown) {
    if (signal.aborted) throw new SpeechError("朗读已取消。", 499);
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new SpeechError("语音合成超时，请重试或缩短选文。", 504);
    throw new SpeechError("无法连接 MiMo 语音服务，请检查网络后重试。", 502);
  } finally { clearTimeout(timeout); }
  if (!response.ok) {
    controller.abort();
    // WHY：不转发供应商错误正文，防止回显密钥或所选书籍原文。
    if (response.status === 401 || response.status === 403) throw new SpeechError("MiMo 密钥无效或没有语音权限，请在设置中更新。", 502);
    if (response.status === 429) throw new SpeechError("语音请求过于频繁或额度不足，请稍后重试。", 429);
    throw new SpeechError("MiMo 语音服务暂不可用，请稍后重试。", 502);
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    controller.abort(); throw new SpeechError("语音服务没有返回流式音频，请重试。", 502);
  }
  return decodeSpeechStream(response.body, () => controller.abort());
}
