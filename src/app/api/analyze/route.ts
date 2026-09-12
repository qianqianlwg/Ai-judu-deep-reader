import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();
  const selectedText = String(body.selectedText || "").trim();
  const context = String(body.context || "").trim();
  if (!selectedText) return NextResponse.json({ error: "没有选中文本" }, { status: 400 });
  const endpoint = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  let result;
  let source = "demo";
  if (endpoint && apiKey) {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.AI_MODEL || "gpt-4o-mini", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: "你是中文经典原著阅读助手。只基于提供的原文和上下文回答，返回 JSON：summary、breakdown（数组，每项含label和text）、concepts（数组，每项含name和text）、context、uncertainty。不要编造引用。" }, { role: "user", content: `选中文本：${selectedText}\n上下文：${context}` }] }) });
    if (response.ok) { const data = await response.json(); result = JSON.parse(data.choices?.[0]?.message?.content || "{}"); source = "ai"; }
  }
  if (!result) result = { summary: "这段文字的核心意思需要结合上下文理解。当前使用演示结果；配置 AI_BASE_URL 和 AI_API_KEY 后将调用真实模型。", breakdown: [{ label: "原文范围", text: "分析对象是用户当前选中的一句或一段。" }, { label: "阅读提示", text: "可以继续结合前后段落，确认作者是在陈述观点、提供理由，还是回应反驳。" }], concepts: [], context: "已传入当前段落及相邻上下文。", uncertainty: "当前为演示分析。" };

  const analysisId = randomUUID();
  if (body.editionId && body.chapterId) {
    db.prepare("INSERT INTO analyses (id, edition_id, chapter_id, paragraph_id, selected_text, context, model_name, prompt_version, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(analysisId, body.editionId, body.chapterId, body.paragraphId || null, selectedText, context, source === "ai" ? (process.env.AI_MODEL || "unknown") : "demo", "v1", JSON.stringify(result), new Date().toISOString());
  }
  return NextResponse.json({ analysisId, source, result });
}

