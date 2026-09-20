import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMobiWorker } from "./mobi-worker-client";
import { makeMobiFixture } from "./mobi-fixture";

describe("固定MOBI worker入口", () => {
  it("真实入口不执行书籍脚本、也不解释外部图片为网络请求", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-worker-entry-"));
    try {
      const parsed = await runMobiWorker({ bytes: makeMobiFixture({ text: '<html><body><p>脚本仅作为待过滤文本</p><script>throw new Error("MUST_NOT_EXECUTE")</script><img src="https://invalid.example/book.png"/></body></html>' }), kind: "mobi", resourceDir: directory });
      expect(parsed.chapters[0].paragraphs).toEqual(["脚本仅作为待过滤文本"]);
    } finally {
      const resolved = path.resolve(directory); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-worker-entry-")) throw new Error("不安全测试清理");
      await rm(resolved, { recursive: true, force: true });
    }
  }, 20000);
});
