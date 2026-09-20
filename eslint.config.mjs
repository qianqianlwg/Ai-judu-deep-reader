import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // WHY：固定版本第三方源码保持原样，由许可证/哈希与集成测试验证，不套用本项目风格规则。
    "public/vendor/foliate/**/*.js",
    "public/vendor/pdfjs/**",
    "vendor/mobi/index.mjs",
    "!public/vendor/foliate/bridge.js",
    "!public/vendor/foliate/security-css.js",
    "work/**",
    ".next*/**",

    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    ".verify-*/**/*",
    ".next-*/**",
    "out/**",
    "build/**",
    "work/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
