import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { GuideError } from "@/lib/guide";
import { readGuideLocations } from "@/lib/guide-location-store";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const { bookId } = await context.params;
    if (new URL(request.url).search) throw new GuideError("全书位置查询参数不正确");
    return NextResponse.json(readGuideLocations(getDb(), bookId), { headers });
  } catch (error: unknown) {
    if (error instanceof GuideError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error("读取导图全书位置失败", error);
    return NextResponse.json({ error: "暂时无法读取全书位置，请重试；导读和原文仍保留。" }, { status: 500, headers });
  }
}
