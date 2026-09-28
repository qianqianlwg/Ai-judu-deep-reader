// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { validateEpubImport } from "./epub-import-security";
import { inspectZip } from "./epub-security-zip";
import { loadEpub } from "./epub-loader";

const directory = process.env.EPUB_COMPATIBILITY_DIR;
const samples = [
  { label: "XHTML 1.1 命名字符实体", hash: "2d3cf3823153056dc9b01ca240c80c63ce57c36815c5d561fa59694cc9f061d2", sections: 87 },
  { label: "DEFLATE 空目录", hash: "0fa7d44b299ef767b0d83637cfff12f47e52d70fcde2670887d29e3c2ea35d90", sections: 29 },
] as const;

// WHY：按用户已提供原件的哈希做本地可复现回归；书籍不进仓库，不上传，不以其他夹具冒充实书验收。
describe.skipIf(!directory)("真实 EPUB 导入预检与全部原版章节兼容回归", () => {
  const files = new Map<string, Buffer>();
  beforeAll(async () => {
    for (const name of await readdir(directory!)) {
      if (!name.toLowerCase().endsWith(".epub")) continue;
      const bytes = await readFile(path.join(directory!, name));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (samples.some(sample => sample.hash === hash)) files.set(hash, bytes);
    }
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:local-compatibility-test");
      static revokeObjectURL = vi.fn();
    });
    await import("../../public/vendor/foliate/bridge.js");
  });
  afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it.each(samples)("$label：原件可校验，全部 $sections 个章节能生成安全 DOM", async sample => {
    const bytes = files.get(sample.hash);
    expect(bytes, "必须提供对应哈希原件，不能把其他 EPUB 当作通过证据").toBeDefined();
    await validateEpubImport(bytes!);
    const blob = new NodeBlob([bytes!]) as unknown as Blob;
    expect((await inspectZip(blob)).size).toBeGreaterThan(1);
    const book = await loadEpub(blob);
    try {
      expect(book.sections).toHaveLength(sample.sections);
      for (const section of book.sections) {
        const doc = await section.createDocument();
        expect(doc.documentElement.localName, section.id).toBe("html");
        expect(doc.querySelectorAll("parsererror,script,[onerror]"), section.id).toHaveLength(0);
        expect(doc.querySelector('head meta[http-equiv="Content-Security-Policy"]'), section.id).not.toBeNull();
        if (sample.label === "XHTML 1.1 命名字符实体" && section.id.endsWith("chapter_1_part1.html")) {
          expect(doc.querySelector("#\\31 -1")?.textContent).toBe("(-)");
        }
      }
    } finally { book.destroy?.(); }
  }, 60000);
});