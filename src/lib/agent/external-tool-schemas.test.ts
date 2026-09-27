import { describe, expect, it } from "vitest";
import { externalSearchSchema, readExternalSchema } from "./external-tool-schemas";
describe("共享的外部来源工具参数", () => {
  it("只接受简短检索词和本轮生成的来源 ID", () => {
    expect(externalSearchSchema.safeParse({ query: "Kant antinomy" }).success).toBe(true);
    expect(externalSearchSchema.safeParse({ query: "Kant antinomy", url: "https://example.org" }).success).toBe(false);
    expect(readExternalSchema.safeParse({ sourceId: "external:openalex:" + "a".repeat(24) }).success).toBe(true);
    expect(readExternalSchema.safeParse({ sourceId: "https://127.0.0.1" }).success).toBe(false);
  });
});
