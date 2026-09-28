import { z } from "zod";
import { rejectUntrustedApiRequest } from "@/lib/request-origin";
import { getJuduDataDir } from "@/lib/data-storage";
import { createSpeechConfigStore } from "@/lib/speech-config";
import { synthesizeSpeech } from "@/lib/speech-provider";
import { MAX_SPEECH_CHUNK, SpeechError } from "@/lib/speech";

export const runtime = "nodejs";
const inputSchema = z.object({ text: z.string().trim().min(1).refine(text => Array.from(text).length <= MAX_SPEECH_CHUNK) }).strict();
export async function POST(request: Request) {
  // WHY：复用项目的真实 Host 来源保护；Next 会规范化回环 URL，不能直接把 request.url 当浏览器来源。
  const rejection = rejectUntrustedApiRequest(request, process.env.JUDU_APP_ORIGIN);
  if (rejection) return Response.json({ error: rejection.message }, { status: rejection.status });
  try {
    const parsed = inputSchema.safeParse(await request.json() as unknown);
    if (!parsed.success) return Response.json({ error: `朗读文本须为 1–${MAX_SPEECH_CHUNK} 字符。` }, { status: 400 });
    // WHY：路由是组合根，集中注入配置目录、环境密钥和网络依赖；业务模块不隐式装配 IO。
    const store = createSpeechConfigStore(getJuduDataDir(), () => process.env.MIMO_API_KEY);
    const audio = await synthesizeSpeech(parsed.data.text, await store.read(), fetch, request.signal);
    return new Response(audio, { headers: { "Content-Type": "audio/pcm", "X-Audio-Sample-Rate": "24000", "X-Audio-Channels": "1", "Cache-Control": "no-store, no-transform", "Content-Encoding": "identity", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return Response.json({ error: "朗读请求不是合法 JSON。" }, { status: 400 });
    console.error("语音合成失败", { name: error instanceof Error ? error.name : "UnknownError", status: error instanceof SpeechError ? error.status : 500 });
    return Response.json({ error: error instanceof SpeechError ? error.message : "语音服务出错，请重试。" }, { status: error instanceof SpeechError ? error.status : 500 });
  }
}
