import { promises as fs } from "node:fs";
import { expect, it } from "vitest";
it("界面字号样式仅覆盖非正文和聊天，不影响书页或原版内容", async () => {
  const css = await fs.readFile("src/components/ui-typography.css", "utf8");
  expect(css).toContain("--ui-text-size");
  expect(css).toContain(".workspace-main > :not(.reading-pane)");
  expect(css).not.toContain(".reader-sheet");
  expect(css).not.toContain("--reading-font-size");
});
