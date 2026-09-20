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

it("原文件响应覆盖全局 CSP，禁止直接激活或嵌入", async () => {
 const rules=await config.headers?.();
 expect(rules?.at(-1)).toEqual({source:"/api/books/:bookId/original",headers:[{key:"Content-Security-Policy",value:"sandbox; default-src 'none'; frame-ancestors 'none'"}]});
});

it("导入路由显式跟踪私有解析产物而不通过public发布", () => {
  expect(config.outputFileTracingIncludes).toEqual({ "/api/import": ["./runtime/mobi/**/*", "./runtime/umd/**/*"] });
});
