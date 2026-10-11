import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readEmbeddingConfig, saveEmbeddingConfig, readAgentRetrievalEnabled, saveAgentRetrievalEnabled } from "@/lib/embedding-store";
import { embedTexts, EmbeddingError } from "@/lib/embedding-provider";

export const runtime = "nodejs";
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function responseConfig() {
  const db = getDb();
  const config = readEmbeddingConfig(db);
  return NextResponse.json({ baseUrl: config.baseUrl, model: config.model, dimensions: config.dimensions, hasApiKey: Boolean(config.apiKey), agentSemanticEnabled: readAgentRetrievalEnabled(db) }, { headers: { "Cache-Control": "no-store" } });
}
export async function GET() { return responseConfig(); }

export async function PUT(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) return NextResponse.json({ error: "\u8bf7\u63d0\u4f9b\u6709\u6548\u914d\u7f6e" }, { status: 400 });
    const allowed = new Set(["apiKey", "baseUrl", "model", "dimensions", "agentSemanticEnabled"]);
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some(key => !allowed.has(key))) return NextResponse.json({ error: "\u914d\u7f6e\u5305\u542b\u672a\u77e5\u5b57\u6bb5" }, { status: 400 });
    if ("agentSemanticEnabled" in body && typeof body.agentSemanticEnabled !== "boolean") return NextResponse.json({ error: "\u81ea\u52a8\u8bed\u4e49\u68c0\u7d22\u5f00\u5173\u5fc5\u987b\u662f\u5e03\u5c14\u503c" }, { status: 400 });
    const hasConfigUpdate = ["apiKey", "baseUrl", "model", "dimensions"].some(key => key in body);
    const db = getDb();
    if (hasConfigUpdate) saveEmbeddingConfig(db, body);
    if ("agentSemanticEnabled" in body) saveAgentRetrievalEnabled(db, body.agentSemanticEnabled);
    return responseConfig();
  } catch (error: unknown) {
    console.error("Embedding settings save failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5411\u91cf API \u914d\u7f6e" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await embedTexts(readEmbeddingConfig(getDb()), ["\u8fde\u63a5\u6d4b\u8bd5"], request.signal);
    return NextResponse.json({ ok: true, message: "\u5411\u91cf\u670d\u52a1\u8fde\u63a5\u6210\u529f" });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof EmbeddingError ? error.message : "\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25" }, { status: 502 });
  }
}
