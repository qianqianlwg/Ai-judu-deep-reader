import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const readCss = async (file: string) => postcss.parse(await readFile(new URL(file, import.meta.url), "utf8"));

describe("工作台主题 CSS 契约", () => {
  it("集中主题文件只控制颜色，不能更改布局、透明拖拽命中区域或正文几何", async () => {
    const css = await readCss("./workspace-theme.css");
    const allowed = new Set(["background", "color", "border-color", "outline-color", "color-scheme", "box-shadow", "opacity"]);
    css.walkDecls(decl => { expect(allowed.has(decl.prop), decl.toString()).toBe(true); });
    css.walkRules(rule => {
      expect(rule.selector).not.toContain("workspace-chat-resizer");
      expect(rule.selector).not.toMatch(/\.sourceLink|\.usageFooter/); // CSS Module 哈希类不可用裸类选择器覆盖。
      for (const selector of rule.selectors) expect(selector.trim()).toMatch(/^(\.app-shell\.workspace-shell|\.judu-)/);
    });
    const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('import "@/components/workspace-theme.css"');
  });
  it("深色下易漏掉的标题、提示、面板均明确消费正确角色", async () => {
    const css = await readCss("./workspace-theme.css");
    const cases = [
      [".workspace-main", "background", "--reading-paper"],
      [".workspace-nav", "background", "--reading-sidebar-background"],
      [".bookshelf-workspace", "background", "--reading-paper"],
      [".workspace-heading h1", "color", "--reading-text"],
      [".workspace-empty h2", "color", "--reading-text"],
      [".analysis-empty h3", "color", "--reading-text"],
      [".analysis-header", "background", "--reading-sidebar-background"],
      [".analysis-panel", "background", "--reading-assistant-background"],
      [".concept-toggle", "background", "--reading-surface"],
      [".selection-bar", "background", "--reading-paper"],
      [".reader-sheet > p", "color", "--reading-text"],
    ];
    for (const [selector, property, token] of cases) {
      let value: string | undefined;
      css.walkRules(rule => {
        if (rule.selectors.includes(".app-shell.workspace-shell " + selector)) rule.walkDecls(property, decl => { value = decl.value; });
      });
      expect(value, selector + ":" + property).toContain(token);
    }
  });
  it("阅读标题的高优先级布局规则也必须跟随主题，不能依赖 CSS 导入顺序", async () => {
    const css = await readCss("./reader-workspace.css");
    let headings = 0;
    css.walkRules(rule => {
      if (!rule.selector.includes(".reader-sheet .page-heading h1")) return;
      rule.walkDecls("color", decl => { expect(decl.value).toBe("var(--reading-text)"); headings++; });
    });
    expect(headings).toBeGreaterThan(0);
  });
  it("设置页主操作在深色亮底按钮上使用反色文字", async () => {
    const css = await readCss("../app/settings/settings.module.css");
    let value: string | undefined;
    css.walkRules(rule => {
      if (rule.selector === ".actions button:last-child") rule.walkDecls("color", decl => { value = decl.value; });
    });
    expect(value).toContain("--reading-paper");
  });
  it.each(["analysis-panel.module.css", "conversation-controls.module.css", "composer-options.module.css", "message-actions.module.css", "reading-marks-panel.module.css", "knowledge-panel.module.css"])("%s 局部样式不得重新写死浅色文字或底色", async file => {
    const css = await readCss("./" + file);
    css.walkDecls(decl => {
      if (decl.prop.startsWith("--") || /shadow|mask/.test(decl.prop)) return;
      expect(decl.value, decl.toString()).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(decl.value, decl.toString()).not.toMatch(/var\(--(?:ink|paper|chrome|line|muted),/);
    });
  });
});
