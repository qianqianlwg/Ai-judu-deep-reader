import { NextResponse, type NextRequest } from "next/server";
import { rejectUntrustedApiRequest } from "@/lib/request-origin";

// WHY：在业务API执行前统一校验，不能让配置测试把已保存密钥发送给第三方网页指定的地址。
export function proxy(request: NextRequest) {
  const rejected = rejectUntrustedApiRequest(request, process.env.JUDU_APP_ORIGIN);
  if (rejected) return NextResponse.json({ error: rejected.message }, { status: rejected.status });
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
