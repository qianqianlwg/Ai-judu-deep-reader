import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { proxy, config } from "./proxy";
afterEach(()=>vi.unstubAllEnvs());
it("代理覆盖所有业务API并在跨站请求进入handler前拒绝",async()=>{vi.stubEnv("JUDU_APP_ORIGIN","");expect(config.matcher).toBe("/api/:path*");const result=proxy(new NextRequest("http://localhost:3000/api/settings/ai",{method:"POST",headers:{origin:"https://untrusted.invalid","content-type":"text/plain"},body:JSON.stringify({baseUrl:"https://untrusted.invalid"})}));expect(result.status).toBe(403);expect(await result.json()).toHaveProperty("error");});
it("同源请求可继续交给业务API",()=>{vi.stubEnv("JUDU_APP_ORIGIN","");const result=proxy(new NextRequest("http://localhost:3000/api/threads",{method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:"{}"}));expect(result.headers.get("x-middleware-next")).toBe("1");});
