import { describe, expect, it } from "vitest";
import { htmlToBlocks } from "./epub-parser";
describe("EPUB 正文块解析", () => {
  it("提取标题和段落并去除标签与实体", () => { const result = htmlToBlocks("<h1>序言</h1><p>第一段&nbsp;文字。</p><p>第二段 <em>重要</em>。</p>"); expect(result.headings).toEqual(["序言"]); expect(result.paragraphs).toEqual(["第一段 文字。", "第二段 重要。"]); });
  it("识别目录块但由章节过滤器负责跳过", () => { const result = htmlToBlocks('<div class="toc"><h1>目录</h1><ul><li><a>第一章</a></li></ul></div>'); expect(result.headings).toEqual(["目录"]); expect(result.paragraphs).toEqual(["第一章"]); });
});
