import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("工作台布局契约", () => {
  it("主区纯白、导航独立、右栏始终聊天，切视图不改变阅读测量尺寸", async () => {
    const css = await readFile(new URL("../components/workspace-nav.css", import.meta.url), "utf8");
    const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(css).toContain("grid-template-columns: 220px minmax(0, 1fr) 390px");
    expect(css).toContain(".workspace-main"); expect(css).toContain("background: #fff");
    expect(css).toContain('[data-workspace-hidden="true"] { visibility: hidden; pointer-events: none; }');
    expect(page).toContain('inert={workspaceView !== "reader"}');
    expect(page).not.toContain("knowledgeOpen ?"); expect(page).not.toContain("top-actions");
  });
  it("保留独立正文实测与聊天滚动容器", async () => {
    const css = await readFile(new URL("../components/reader-workspace.css", import.meta.url), "utf8");
    const global = await readFile(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain(".reader-sheet > p"); expect(css).toContain("grid-template-rows: 52px minmax(0, 1fr) auto 42px");
    expect(global).toContain(".chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto");
  });
});
