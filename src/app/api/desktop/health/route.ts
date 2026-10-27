import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.JUDU_DESKTOP_TOKEN;
  const supplied = request.headers.get("x-judu-desktop-token");
  // WHY：只在桌面后台启用；校验随机令牌和真实 PID，避免端口竞争时误把其他本地服务当成已启动的核心。
  if (!expected || expected.length < 32 || !supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ protocol: 1, pid: process.pid, platform: process.platform }, {
    headers: { "Cache-Control": "no-store" },
  });
}
