import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    // WHY：UI 之外再加响应头兜底，禁止不可信模型/书籍内容自动加载第三方图片或嵌入对象。
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ] }];
  },
};

export default nextConfig;
