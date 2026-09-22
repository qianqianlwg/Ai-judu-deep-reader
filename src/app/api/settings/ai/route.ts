import { NextRequest, NextResponse } from "next/server";
import {normalizeModelChoices,readModelChoices,saveModelChoices} from "@/lib/model-choices";
import { getDb } from "@/lib/db";
import { buildProviderHeaders, buildProviderRequestBody, buildProviderUrl, type AiProviderKind, type ProviderConfig, type ProviderRequest } from "@/lib/ai-provider";

export const runtime = "nodejs";
const CONFIG_ID = "default";
type StoredConfig = ProviderConfig & { updatedAt: string };
function validProvider(value: unknown): value is AiProviderKind { return value === "openai" || value === "claude"; }
function readConfig(body: Record<string, unknown>, existing?: ProviderConfig): ProviderConfig {
  const provider = validProvider(body.provider) ? body.provider : existing?.provider ?? "openai";
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : existing?.baseUrl ?? "https://api.openai.com/v1";
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : existing?.apiKey ?? "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : existing?.model ?? "gpt-4o-mini";
  if (!apiKey) throw new Error("API Key 不能为空");
  return { provider, baseUrl, apiKey, model };
}
function rowToConfig(row: unknown): StoredConfig | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  if (typeof item.provider !== "string" || typeof item.base_url !== "string" || typeof item.api_key !== "string" || typeof item.model !== "string") return null;
  return { provider: item.provider as AiProviderKind, baseUrl: item.base_url, apiKey: item.api_key, model: item.model, updatedAt: String(item.updated_at ?? "") };
}
function getStored(): StoredConfig | null { return rowToConfig(getDb().prepare("SELECT provider, base_url, api_key, model, updated_at FROM ai_provider_configs WHERE id = ?").get(CONFIG_ID)); }
function publicConfig(config: StoredConfig | null) { return config ? { provider: config.provider, baseUrl: config.baseUrl, model: config.model, hasApiKey: Boolean(config.apiKey), maskedApiKey: config.apiKey ? (config.apiKey.length > 8 ? `${config.apiKey.slice(0, 4)}••••${config.apiKey.slice(-4)}` : "••••") : "" } : { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", hasApiKey: false, maskedApiKey: "" }; }
export async function GET() { return NextResponse.json({...publicConfig(getStored()), models:readModelChoices(getDb(),getStored()?.model??"gpt-4o-mini")}); }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const current = getStored();
    const config = readConfig(body, current ?? undefined);
    const models=normalizeModelChoices(body.models??[...new Set([config.model,...readModelChoices(getDb(),config.model)])],config.model);
    if (!models.includes(config.model)) throw new Error("默认模型必须包含在模型列表中");
    const db=getDb(); db.exec("BEGIN IMMEDIATE");
    try {
    db.prepare("INSERT INTO ai_provider_configs (id, provider, base_url, api_key, model, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, updated_at=excluded.updated_at").run(CONFIG_ID, config.provider, config.baseUrl, config.apiKey, config.model, new Date().toISOString());
    saveModelChoices(db,models); db.exec("COMMIT");
    } catch(error:unknown) { db.exec("ROLLBACK"); throw error; }
    return GET();
  } catch (error: unknown) { console.error("保存 AI 配置失败", error); return NextResponse.json({ error: error instanceof Error ? error.message : "保存 AI 配置失败" }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const config = readConfig(body, getStored() ?? undefined);
    const providerRequest: ProviderRequest = { messages: [{ role: "user", content: "请只回复：连接成功" }], maxTokens: 32, stream: false };
    const upstream = await fetch(buildProviderUrl(config), { method: "POST", headers: buildProviderHeaders(config), body: JSON.stringify(buildProviderRequestBody(config, providerRequest)), signal: AbortSignal.timeout(15000) });
    // WHY：网关错误可能回显鉴权内容，不能把原始错误体返回客户端。
    await upstream.text();
    if (!upstream.ok) return NextResponse.json({ error: `模型服务返回 ${upstream.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, message: "连接成功" });
  } catch (error: unknown) { console.error("测试 AI 配置失败", { name: error instanceof Error ? error.name : "UnknownError" }); return NextResponse.json({ error: "连接测试失败，请检查服务地址、模型和密钥。" }, { status: 400 }); }
}
