import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runUmdWorker } from "./umd-worker-client";
import { makeUmdFixture } from "./umd-fixture";
import { parseUmd } from "./umd-parser";
afterEach(() => vi.restoreAllMocks());
describe("真实UMD进程入口", () => {
  it("真实受限进程返回与纯解析一致的结果，输入快照不受外部修改影响", async () => {
    const input = makeUmdFixture({ title: "<script>不可执行</script>", indexOrder: [1, 0] }); const expected = await parseUmd(input);
    const pending = runUmdWorker(input); input.fill(0); expect(await pending).toEqual(expected);
  });
  it("无源码/第三方依赖的独立部署根仍能运行，缺产物有明确提示", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "judu-umd-runtime-")), runtime = path.resolve("runtime/umd");
    try {
      vi.spyOn(process, "cwd").mockReturnValue(root);
      await expect(runUmdWorker(makeUmdFixture())).rejects.toThrow("build:umd-worker");
      await cp(runtime, path.join(root, "runtime/umd"), { recursive: true });
      const input = makeUmdFixture(); const result = await runUmdWorker(input);
      expect(result.sourceHash).toBe(createHash("sha256").update(input).digest("hex"));
      expect(result.chapters[0].text).toContain("中文与emoji😀。");
    } finally {
      vi.restoreAllMocks();
      if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("judu-umd-runtime-")) throw new Error("清理越界");
      await rm(root, { recursive: true, force: true });
    }
  });
  it("坏UMD错误原样明确反馈，不返回裁短的正文", async () => {
    await expect(runUmdWorker(makeUmdFixture({ terminator: false }))).rejects.toThrow("终止");
    await expect(runUmdWorker(makeUmdFixture({ kind: 3 }))).rejects.toThrow("文字型");
  });
});
