import { z } from "zod";
import { rejectUntrustedApiRequest } from "@/lib/request-origin";
import { getJuduDataDir } from "@/lib/data-storage";
import { createSpeechConfigStore, publicSpeechConfig } from "@/lib/speech-config";
import { SpeechError, speechPreferencesSchema } from "@/lib/speech";

export const runtime = "nodejs";
const updateSchema = speechPreferencesSchema.extend({ apiKey: z.string().trim().max(256).optional() }).strict();
function store() { return createSpeechConfigStore(getJuduDataDir(), () => process.env.MIMO_API_KEY); }
function failure(error: unknown) {
  console.error("语音配置操作失败", { name: error instanceof Error ? error.name : "UnknownError" });
  return Response.json({ error: error instanceof SpeechError ? error.message : "语音配置操作失败，请检查服务端权限后重试。" }, { status: error instanceof SpeechError ? error.status : 500 });
}
export async function GET() {
  try { return Response.json(publicSpeechConfig(await store().read()), { headers: { "Cache-Control": "no-store" } }); }
  catch (error: unknown) { return failure(error); }
}
export async function PUT(request: Request) {
  // WHY：复用项目的真实 Host 来源保护；Next 会规范化回环 URL，不能直接把 request.url 当浏览器来源。
  const rejection = rejectUntrustedApiRequest(request, process.env.JUDU_APP_ORIGIN);
  if (rejection) return Response.json({ error: rejection.message }, { status: rejection.status });
  try {
    const parsed = updateSchema.safeParse(await request.json() as unknown);
    if (!parsed.success) return Response.json({ error: "语音配置无效，请检查音色、语速、音量和风格（最多 500 字）。" }, { status: 400 });
    const { apiKey, ...preferences } = parsed.data;
    return Response.json(publicSpeechConfig(await store().save(preferences, apiKey)), { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return Response.json({ error: "语音配置请求不是合法 JSON。" }, { status: 400 });
    return failure(error);
  }
}

