import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("霞鹜文楷本地字库", () => {
  it("仅选中时通过字体族使用自托管文件，未选择不请求第三方字体", async () => {
    const css = await fs.readFile("src/components/lxgw-wenkai.css", "utf8");
    expect(css.charCodeAt(0)).not.toBe(0xfeff);
    expect(css).toContain('font-family: "LXGW WenKai Reader"');
    expect(css).toContain('url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf")');
    expect(css).toContain("font-display: swap");
    expect(css).not.toMatch(/https?:\/\//u);
  });
  it("字体文件不为空，保留上游授权和来源信息", async () => {
    const dir = path.join("public", "fonts", "lxgw-wenkai");
    const stat = await fs.stat(path.join(dir, "LXGWWenKai-Regular.ttf"));
    expect(stat.size).toBeGreaterThan(1_000_000);
    const handle = await fs.open(path.join(dir, "LXGWWenKai-Regular.ttf"), "r");
    try { const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0); expect(header.readUInt32BE()).toBe(0x00010000); }
    finally { await handle.close(); }
    expect(await fs.readFile(path.join(dir, "OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(await fs.readFile(path.join(dir, "PROVENANCE.txt"), "utf8")).toContain("https://github.com/lxgw/LxgwWenKai");
  });
});
