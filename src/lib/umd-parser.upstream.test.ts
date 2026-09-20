import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectUmdContainer } from "./umd-container";
import { parseUmd } from "./umd-parser";
import { runUmdWorker } from "./umd-worker-client";
import { convertUmdFile } from "./umd-conversion";
import { makeUmdFixture } from "./umd-fixture";
const location = "src/lib/fixtures/umd/flyfish-book.umd";
describe("固定上游独立UMD实物：未经改写的简化文字profile", () => {
  it("627字节原件、发布许可与provenance匹配，不添加伪81或终止记录", async () => {
    const bytes = await readFile(location), sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest = JSON.parse((await readFile("src/lib/fixtures/umd/PROVENANCE.json", "utf8")).replace(/^\ufeff/u, "")) as { sha256: string; bytes: number; modified: boolean };
    expect(sha256).toBe("472dd236088ed386c72234d6aa469f24973a4e8972380ff50429be6fc6f16052");
    expect(manifest).toMatchObject({ sha256, bytes: bytes.length, modified: false });
    expect(await readFile("src/lib/fixtures/umd/LICENSE", "utf8")).toContain("Apache License");
    const container = inspectUmdContainer(bytes); expect(container.profile).toBe("simple-eof");
    expect(container.offsets).toEqual([0, 208]); expect(container.declaredBytes).toBe(380);
    const direct = await parseUmd(bytes), isolated = await runUmdWorker(bytes); expect(isolated).toEqual(direct);
    expect(direct.title).toBe("Flyfish UMD 电子书样本"); expect(direct.author).toBe("Flyfish Viewer");
    expect(direct.chapters).toHaveLength(2);
    expect(direct.chapters.map(chapter => [chapter.startByte, chapter.endByte])).toEqual([[0, 208], [208, 380]]);
    const result = await convertUmdFile(bytes);
    expect(result.document.chapters).toHaveLength(2); expect(result.sourceHash).toBe(sha256);
    expect(result.document.chapters[0].paragraphs.join("\n")).toContain("UMD");
  });
  it("真实样本每个截断位置仍拒绝；有索引的损坏文件不能降级为无终止布局", async () => {
    const bytes = await readFile(location);
    for (let length = 0; length < bytes.length; length++) expect(() => inspectUmdContainer(bytes.subarray(0, length)), String(length)).toThrow();
    const extra = Buffer.concat([bytes, Buffer.from([0])]); expect(() => inspectUmdContainer(extra)).toThrow();
    await expect(runUmdWorker(makeUmdFixture({ terminator: false }))).rejects.toThrow("终止");
  });
});
