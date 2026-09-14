import { expect, it } from "vitest";
import config from "./next.config";
it("所有页面和API禁止第三方图片、对象及referrer外泄", async () => {
  const rules = await config.headers?.();
  expect(rules).toEqual(expect.arrayContaining([expect.objectContaining({ source: "/:path*" })]));
  const headers = rules?.[0].headers ?? [];
  expect(headers).toContainEqual({key:"Referrer-Policy",value:"no-referrer"});
  const csp = headers.find(item=>item.key === "Content-Security-Policy")?.value;
  expect(csp).toContain("img-src 'self' data: blob:"); expect(csp).toContain("object-src 'none'"); expect(csp).not.toContain("https:");
});
