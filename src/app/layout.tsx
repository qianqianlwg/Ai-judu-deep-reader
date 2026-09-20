import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  DEFAULT_READING_APPEARANCE, getReadingAppearanceBootstrapScript, getReadingAppearanceVariables,
} from "@/lib/reading-appearance";
import "./globals.css";
import "@/components/workspace-theme.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "句读｜AI 深度阅读器",
  description: "基于原著上下文的 AI 深度阅读器",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // WHY：服务端先输出浅色默认值；head 内同步脚本在首屏绘制前覆盖本地主题，避免设置页与阅读器闪回默认色。
  const defaultVariables = getReadingAppearanceVariables(DEFAULT_READING_APPEARANCE) as CSSProperties;
  return <html lang="zh-CN" data-reading-theme={DEFAULT_READING_APPEARANCE.theme} suppressHydrationWarning
    className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} style={defaultVariables}>
    <head><script dangerouslySetInnerHTML={{ __html: getReadingAppearanceBootstrapScript() }} /></head>
    <body className="min-h-full flex flex-col" style={{ background: "var(--reading-paper, #fffdf9)", color: "var(--reading-text, #263238)" }}>{children}</body>
  </html>;
}
