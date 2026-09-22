import {NextResponse} from "next/server";
import {getDb} from "@/lib/db";
import {normalizeDisplayTitle,setBookDisplayTitle} from "@/lib/book-display-title";
export const runtime="nodejs";
export async function PATCH(request: Request, {params}: {params: Promise<{bookId:string}>}) {
  const {bookId}=await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(bookId)) return NextResponse.json({error:"书籍 ID 不合法"},{status:400});
  let title: string | null;
  try {
    const body: unknown=await request.json();
    if (!body || typeof body!=="object" || Array.isArray(body) || !("displayTitle" in body)) throw new Error("请提供显示书名");
    title=normalizeDisplayTitle(body.displayTitle);
  } catch (cause: unknown) {return NextResponse.json({error:cause instanceof Error ? cause.message : "请求无效"},{status:400});}
  try {
    if (!setBookDisplayTitle(getDb(),bookId,title)) return NextResponse.json({error:"书籍不存在"},{status:404});
    return NextResponse.json({bookId,displayTitle:title},{headers:{"Cache-Control":"no-store"}});
  } catch (cause: unknown) {console.error("更新显示书名失败",cause);return NextResponse.json({error:"显示书名保存失败，请重试"},{status:500});}
}
