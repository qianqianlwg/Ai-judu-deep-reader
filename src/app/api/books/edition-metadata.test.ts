import { describe, expect, it } from "vitest";
import { publicEdition } from "./edition-metadata";
describe("public edition metadata", () => {
  it("exposes only the allowlist and never claims EPUB rendering readiness", () => {
    const row = { id: "e", bookId: "b", fileName: "a.epub", fileType: ".epub", hasOriginalFile: 1, fileSize: 42, originalHash: "a".repeat(64), createdAt: "now", originalFilePath: "secret", readerMode: "epub" };
    expect(publicEdition(row)).toEqual({ id: "e", fileName: "a.epub", fileType: ".epub", hasOriginalFile: true, fileSize: 42, originalHash: "a".repeat(64), createdAt: "now", readerMode: "text" });
    expect(publicEdition({ ...row, hasOriginalFile: 0, fileSize: 0, originalHash: null })).not.toHaveProperty("originalHash");
  });
});
