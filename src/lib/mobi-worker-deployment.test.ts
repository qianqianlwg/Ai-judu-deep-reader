import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeKf8Fixture } from "./kf8-fixture";
import { makeMobiFixture } from "./mobi-fixture";
import { runMobiWorker } from "./mobi-worker-client";

const runtime = path.resolve("runtime/mobi");
afterEach(() => vi.restoreAllMocks());

describe("MOBI运行时部署闭环：私有文件而非源码树或开发依赖", () => {
  it("缺失私有产物时明确告知构建命令，不回退开发源码", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(runtime, "missing-root"));
    await expect(runMobiWorker({ bytes: makeMobiFixture(), kind: "mobi", resourceDir: os.tmpdir() }))
      .rejects.toThrow("npm run build:mobi-worker");
  });
  it.each(["mobi", "kf8"] as const)("仅复制运行时到独立根目录仍能解析%s", async kind => {
    const root = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-deploy-"));
    const resources = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-deploy-"));
    try {
      await cp(runtime, path.join(root, "runtime/mobi"), { recursive: true });
      expect(await readdir(root)).toEqual(["runtime"]);
      // WHY：测试部署根里没有src/vendor/node_modules；实际子进程仅获单个bundle的读取权限。
      vi.spyOn(process, "cwd").mockReturnValue(root);
      const bytes = kind === "mobi" ? makeMobiFixture() : makeKf8Fixture({ fdst: "none" });
      const value = await runMobiWorker({ bytes, kind, resourceDir: resources });
      expect(value.chapters).toHaveLength(kind === "mobi" ? 2 : 1);
      expect(value.chapters.flatMap(chapter => chapter.paragraphs).join("\n"))
        .toContain(kind === "mobi" ? "第二段😀。" : "这是自造的中文正文。");
      if (kind === "kf8") expect(value.chapters[0].title).toContain("星河 🐉");
      expect(await readdir(resources)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      for (const directory of [root, resources]) {
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-deploy-")) throw new Error("测试清理越界");
        await rm(resolved, { recursive: true, force: true });
      }
    }
  }, 20000);
});
