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
 expect(rules?.find(rule => rule.source === "/api/books/:bookId/original")).toEqual({source:"/api/books/:bookId/original",headers:[{key:"Content-Security-Policy",value:"sandbox; default-src 'none'; frame-ancestors 'none'"}]});
});

it("导入路由显式跟踪私有解析产物而不通过public发布", () => {
  const foliate = ["./scripts/epub/**/*", "./public/vendor/foliate/epub.js", "./public/vendor/foliate/epubcfi.js", "./public/vendor/foliate/package.json"];
  expect(config.outputFileTracingIncludes).toEqual({ "/api/import": ["./runtime/mobi/**/*", "./runtime/umd/**/*", "./node_modules/pdfjs-dist/legacy/build/pdf.mjs", "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/@napi-rs/canvas/**/*", "./node_modules/@napi-rs/canvas-*/**/*", ...foliate], "/api/books/*": foliate, "/api/books/*/mobi-layout": ["./runtime/mobi/**/*"] });
});

it("派生转换版同样只能以严格隔离的附件下载", async () => {
 const rules=await config.headers?.();expect(rules?.find(rule=>rule.source==="/api/books/:bookId/converted")?.headers).toContainEqual({key:"Content-Security-Policy",value:"sandbox; default-src 'none'; frame-ancestors 'none'"});
});

it('代理缓冲允许300MB文件及multipart开销，使用新版配置名',()=>{expect(config.experimental?.proxyClientMaxBodySize).toBe(302*1024*1024);expect(config.experimental?.middlewareClientMaxBodySize).toBeUndefined();});

it("生产构建启用独立运行产物，默认仍保留主项目构建目录", () => {
  expect(config.output).toBe("standalone");
  expect(config.distDir).toBe(process.env.NEXT_DIST_DIR ?? ".next");
});
