import {IMPORT_PROXY_BUFFER_BYTES} from "./src/lib/import-limits";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WHY：这是 Next.js 开发模式的路由状态指示器，不属于产品 UI；关闭可避免左下角出现 N 徽标。
  devIndicators: false,
  // WHY：上传代理缓冲覆盖300MB文件及multipart开销，避免正文被默认10MB静默截断。
  experimental: { proxyClientMaxBodySize: IMPORT_PROXY_BUFFER_BYTES },
  // WHY：worker由子进程加载，不能依赖静态import推断；导入与MOBI布局路由携带私有运行时和许可。
  outputFileTracingIncludes: { "/api/import": ["./runtime/mobi/**/*", "./runtime/umd/**/*"], "/api/books/*/mobi-layout": ["./runtime/mobi/**/*"] },
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    // WHY：UI 之外再加响应头兜底，禁止不可信模型/书籍内容自动加载第三方图片或嵌入对象。
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }, {
      // WHY：Next 全局 headers 会覆盖路由响应头；原件下载必须恢复更严格的隔离策略。
      source: "/api/books/:bookId/original",
      headers: [{ key: "Content-Security-Policy", value: "sandbox; default-src 'none'; frame-ancestors 'none'" }],
    }, {
      source: "/api/books/:bookId/converted",
      headers: [{ key: "Content-Security-Policy", value: "sandbox; default-src 'none'; frame-ancestors 'none'" }],
    }];
  },
};

export default nextConfig;
