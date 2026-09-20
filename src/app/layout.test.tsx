// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_READING_APPEARANCE, READING_APPEARANCE_STORAGE_KEYS } from "@/lib/reading-appearance";
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "--font-test-sans" }), Geist_Mono: () => ({ variable: "--font-test-mono" }) }));
vi.mock("./globals.css", () => ({}));
import RootLayout from "./layout";

describe("根布局阅读外观引导", () => {
  it("在 head 内同步注入主题脚本，并允许它覆盖默认 html 主题", () => {
    const element = RootLayout({ children: <main>content</main> });
    expect(element.props.suppressHydrationWarning).toBe(true);
    expect(element.props["data-reading-theme"]).toBe(DEFAULT_READING_APPEARANCE.theme);
    const markup = renderToStaticMarkup(element);
    expect(markup.indexOf("<head>")).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf("<head>")).toBeLessThan(markup.indexOf("<body"));
    expect(markup).toContain(READING_APPEARANCE_STORAGE_KEYS.preferences);
    expect(markup).toContain("dataset.readingTheme");
    expect(markup).not.toContain("defer"); expect(markup).not.toContain("async");
  });
  it("默认 server html 使用同一组灰白默认变量，主题切换不伪装为全站国际化", () => {
    const element = RootLayout({ children: null });
    expect(element.props.lang).toBe("zh-CN");
    expect(element.props.style["--reading-paper"]).toBe("#FFFFFF");
    expect(element.props.children[1].props.style.background).toContain("--reading-paper");
  });
});
