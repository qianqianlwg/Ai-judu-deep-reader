import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("桌面阅读器布局契约", () => {
  it("维持中间纯白、左右面板分色与独立滚动", async () => {
    const css = await readFile(new URL("./globals.css", import.meta.url), "utf8");
    expect(css).toContain("grid-template-columns: 205px minmax(0, 1fr) 390px");
    expect(css).toContain(".reading-pane { min-width: 0; min-height: 0; overflow: hidden");
    expect(css).toContain(".chat-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto");
    expect(css).toContain(".chat-composer { flex: 0 0 auto");
    expect(css).toMatch(/.reading-pane, .page-nav, .selection-bar { background: #ffffff/);
  });
});
