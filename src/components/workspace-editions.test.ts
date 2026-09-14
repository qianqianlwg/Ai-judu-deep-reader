import { describe, expect, it } from "vitest";
import { editionActionLabel, editionImportTime, editionLabel } from "./workspace-editions";
describe("版本辨识信息", () => {
  it("文件、绝对导入时间和完整身份均可辨识", () => {
    const edition = { id: "edition-id", fileName: "注释本.epub", fileType: "epub", createdAt: "2026-01-01T12:00:00Z" };
    expect(editionLabel(edition)).toContain("注释本.epub"); expect(editionLabel(edition)).toContain("2026");
    expect(editionActionLabel({ id: "book-id", title: "同名书", author: "作者" }, edition)).toContain("版本 edition-id · 书籍 book-id");
  });
  it("缺失导入时间不伪造日期", () => { expect(editionImportTime("")).toBe("导入时间未记录"); });
});
