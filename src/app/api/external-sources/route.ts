import { externalAvailability } from "@/lib/agent/external-availability";
export const runtime = "nodejs";
// WHY：只公开来源是否可用，密钥和服务端地址永不发送给浏览器。
export function GET() { return Response.json({ available: externalAvailability() }, { headers: { "Cache-Control": "no-store" } }); }
