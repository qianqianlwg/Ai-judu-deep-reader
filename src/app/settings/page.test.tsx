import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import SettingsPage from "./page";

describe("设置页", () => { it("提供返回入口和阅读设置", () => { const html = renderToString(<SettingsPage />); expect(html).toContain("设置"); expect(html).toContain("返回阅读器"); expect(html).toContain("正文大小"); }); });
