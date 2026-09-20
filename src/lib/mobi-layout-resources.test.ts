import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { constants, type Dir } from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureMobiResources } from "./mobi-layout-resources.mjs";
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));
const originalLstat = fs.lstat, originalOpen = fs.open;
const LIMIT = 100 * 1024 * 1024;
let root: string, directory: string, tempBase: string;
const resourcePath = (name: string) => path.join(directory, name);
const write = (name: string, text: string | Uint8Array) => fs.writeFile(resourcePath(name), text);
beforeEach(async () => {
  tempBase = await fs.realpath(os.tmpdir());
  root = await fs.mkdtemp(path.join(tempBase, "judu-mobi-snapshot-test-"));
  directory = path.join(root, "resources"); await fs.mkdir(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  // WHY：清理只针对本用例 mkdtemp 返回的已核验绝对目录，不使用书内路径或未核验的递归删除目标。
  const resolved = path.resolve(root), stat = await originalLstat(resolved);
  if (resolved !== root || path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith("judu-mobi-snapshot-test-")
    || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("拒绝清理未核验的测试目录");
  await fs.rm(resolved, { recursive: true, force: true });
});

describe("本地资源快照与稳定身份", () => {
  it("空目录可用，文件按ASCII稳定排序；伪PNG字节也保持不可信原样而非声称图像验证", async () => {
    const empty = await captureMobiResources(directory); expect(empty.resources).toEqual([]);
    const raw = new Uint8Array([0, 255, 7]);
    await write("z.bin", raw); await write("11.png", raw); await write("1.png", raw);
    const snapshot = await captureMobiResources(directory), again = await captureMobiResources(directory);
    expect(snapshot.resources).toEqual(again.resources);
    expect(snapshot.resources.map(item => item.id)).toEqual(["mobi-resource-v1/1.png", "mobi-resource-v1/11.png", "mobi-resource-v1/z.bin"]);
    expect(snapshot.resources[0]).toEqual({ id: "mobi-resource-v1/1.png", mediaType: "image/png", bytes: raw });
    expect(snapshot.idFor(resourcePath("1.png"))).toBe("mobi-resource-v1/1.png");
    await write("1.png", "changed"); expect(snapshot.resources[0].bytes).toEqual(raw);
  });
  it("不同临时目录产生相同包内ID与文本字节", async () => {
    const other = path.join(root, "second"); await fs.mkdir(other);
    await write("x.png", "x"); await fs.writeFile(path.join(other, "x.png"), "x");
    await write("a.css", "a{background:url(" + resourcePath("x.png") + ")}");
    await fs.writeFile(path.join(other, "a.css"), "a{background:url(" + path.join(other, "x.png") + ")}");
    expect((await captureMobiResources(directory)).resources).toEqual((await captureMobiResources(other)).resources);
  });
  it.each([
    ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["gif", "image/gif"], ["bmp", "image/bmp"],
    ["svg", "image/svg+xml"], ["css", "text/css"], ["xml", "application/xml"], ["xhtml", "application/xhtml+xml"], ["html", "text/html"],
    ["mp4", "video/mp4"], ["mkv", "video/x-matroska"], ["webm", "video/webm"], ["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["ogg", "audio/ogg"],
    ["ttf", "font/ttf"], ["otf", "font/otf"], ["woff", "font/woff"], ["woff2", "font/woff2"], ["eot", "application/vnd.ms-fontobject"], ["bin", "application/octet-stream"],
  ])("扩展名%s只提供MIME提示", async (extension, mediaType) => {
    await write("R_0-x." + extension, "untrusted");
    expect((await captureMobiResources(directory)).resources[0].mediaType).toBe(mediaType);
  });
  it("CSS前向嵌套引用和全部文本类型都改写；中文emoji/BOM与Windows原始反斜杠不被转义破坏", async () => {
    await write("1.png", new Uint8Array([1]));
    await write("nested.css", 'body{background:url("' + resourcePath("1.png") + '#a")}');
    await write("a.css", '@import "' + resourcePath("nested.css") + '";');
    for (const ext of ["svg", "xml", "xhtml", "html"]) await write("r." + ext, '\ufeff<p src="' + resourcePath("1.png") + '">自创😀</p>');
    const snapshot = await captureMobiResources(directory);
    const text = (name: string) => Buffer.from(snapshot.resources.find(item => item.id.endsWith("/" + name))!.bytes).toString("utf8");
    expect(text("a.css")).toBe('@import "mobi-resource-v1/nested.css";');
    expect(text("nested.css")).toBe('body{background:url("mobi-resource-v1/1.png#a")}');
    for (const ext of ["svg", "xml", "xhtml", "html"]) expect(text("r." + ext)).toBe('\ufeff<p src="mobi-resource-v1/1.png">自创😀</p>');
    expect(snapshot.rewrite('<img src="' + resourcePath("1.png") + '?v=1">')).toBe('<img src="mobi-resource-v1/1.png?v=1">');
    expect(snapshot.rewrite(snapshot.rewrite(resourcePath("1.png")))).toBe("mobi-resource-v1/1.png");
  });
  it("不执行净化HTML/CSS，也不下载外部资源", async () => {
    const text = '<script>throw new Error("never execute")</script><img src="https://example.invalid/a.png"><style>@import "https://example.invalid/a.css";</style>';
    await write("x.html", text);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("禁止网络"));
    const snapshot = await captureMobiResources(directory);
    expect(Buffer.from(snapshot.resources[0].bytes).toString("utf8")).toBe(text);
    expect(snapshot.rewrite(text)).toBe(text); expect(network).not.toHaveBeenCalled();
  });
  it("已捕获路径精确匹配，1.png不能误命中11.png，未知/前缀子串不部分替换", async () => {
    await write("1.png", "1"); await write("11.png", "11");
    const { rewrite, idFor } = await captureMobiResources(directory);
    expect(rewrite(resourcePath("1.png") + " " + resourcePath("11.png"))).toBe("mobi-resource-v1/1.png mobi-resource-v1/11.png");
    for (const value of [resourcePath("111.png"), resourcePath("1.png") + ".bak", resourcePath("1.png") + "/tail", "prefix" + resourcePath("1.png"), "https://host/" + resourcePath("1.png"), directory]) {
      expect(() => rewrite(value)).toThrow(/引用|未解析/u);
    }
    for (const value of ["1.png", resourcePath("missing.png"), resourcePath("1.png").toUpperCase(), resourcePath("1.png") + "#a"]) expect(() => idFor(value)).toThrow(/捕获/u);
    expect(rewrite(directory + "-sibling" + path.sep + "1.png")).toBe(directory + "-sibling" + path.sep + "1.png");
    expect(() => idFor(null as unknown as string)).toThrow(/捕获/u);
    if (path.sep === "\\") expect(() => rewrite(resourcePath("1.png").replaceAll("\\", "/"))).toThrow(/未解析/u);
  });
});

describe("拒绝非法资源和不完整引用", () => {
  it.each(["bad name.png", "x.PNG", ".png", "x.exe", "two.dots.png", "汉字.png"])("拒绝非法文件名%s", async name => {
    await write(name, "x"); await expect(captureMobiResources(directory)).rejects.toThrow(/文件名/u);
  });
  it("拒绝目录条目，包括伪装成合法扩展名", async () => {
    await fs.mkdir(resourcePath("folder.png")); await expect(captureMobiResources(directory)).rejects.toThrow(/目录/u);
  });
  it("拒绝条目符号链接/Windows junction", async () => {
    const target = path.join(root, "outside"); await fs.mkdir(target);
    await fs.symlink(target, resourcePath("link.png"), "junction");
    await expect(captureMobiResources(directory)).rejects.toThrow(/链接/u);
  });
  it("逐级拒绝祖先和资源根的符号链接，不仅检查叶文件", async () => {
    const alias = path.join(root, "alias"); await fs.symlink(directory, alias, "junction");
    await expect(captureMobiResources(alias)).rejects.toThrow(/链接/u);
    const child = path.join(directory, "child"); await fs.mkdir(child);
    await expect(captureMobiResources(path.join(alias, "child"))).rejects.toThrow(/链接/u);
  });
  it.each(["relative", "", null, 7, "bad\0path"])("拒绝非法目录输入%j", async value => {
    await expect(captureMobiResources(value as string)).rejects.toThrow(/目录/u);
  });
  it("UNC共享和设备路径在任何文件IO前拒绝", async () => {
    const stat = vi.spyOn(fs, "lstat");
    for (const value of [String.raw`\serverooks
esources`, String.raw`\?
o-device
esources`]) {
      await expect(captureMobiResources(value)).rejects.toThrow(/目录/u);
    }
    expect(stat).not.toHaveBeenCalled();
  });
  it("拒绝根目录和含未规范化父目录的路径，不读取它们", async () => {
    await expect(captureMobiResources(path.parse(directory).root)).rejects.toThrow(/目录/u);
    await expect(captureMobiResources(directory + path.sep + ".." + path.sep + "resources")).rejects.toThrow(/目录/u);
  });
  it.each(["css", "svg", "xml", "xhtml", "html"])("%s损坏UTF8不能替换成丢失字符", async ext => {
    await write("x." + ext, new Uint8Array([0xc3, 0x28]));
    await expect(captureMobiResources(directory)).rejects.toThrow(/UTF8/u);
  });
  it("文本引用本目录未捕获路径必须失败，错误正文不泄漏临时路径", async () => {
    await write("x.css", 'a{background:url("' + resourcePath("missing.png") + '")}');
    await expect(captureMobiResources(directory)).rejects.toThrow(/引用未捕获/u);
    try { await captureMobiResources(directory); } catch (cause) { expect((cause as Error).message).not.toContain(directory); }
    await expect(captureMobiResources(path.join(directory, "missing"))).rejects.toThrow(/^MOBI资源本地快照失败$/u);
  });
});

describe("读取前预算与打开前后身份复核", () => {
  function sizes(values: Record<string, number>) {
    vi.spyOn(fs, "lstat").mockImplementation(async (name, options) => {
      const stat = await originalLstat(name, options);
      const size = values[String(name)]; if (size !== undefined) Object.assign(stat, { size: BigInt(size) });
      return stat;
    });
  }
  it("真实0字节文件拒绝；rewrite同样拒绝超预算文本且不分配文件缓冲区", async () => {
    await write("x.bin", new Uint8Array(0));
    await expect(captureMobiResources(directory)).rejects.toThrow(/单项大小/u);
    await fs.unlink(resourcePath("x.bin")); const { rewrite } = await captureMobiResources(directory);
    expect(() => rewrite(null as unknown as string)).toThrow(/类型/u);
    expect(() => rewrite("x".repeat(LIMIT + 1))).toThrow(/预算/u);
  });
  it.each([0, LIMIT + 1])("单项%s字节在open和读取分配前拒绝", async size => {
    await write("x.bin", "x"); sizes({ [resourcePath("x.bin")]: size });
    const open = vi.spyOn(fs, "open");
    await expect(captureMobiResources(directory)).rejects.toThrow(/单项大小/u); expect(open).not.toHaveBeenCalled();
  });
  it("累计超限在任何资源读取之前拒绝", async () => {
    await write("a.bin", "a"); await write("b.bin", "b"); sizes({ [resourcePath("a.bin")]: LIMIT, [resourcePath("b.bin")]: 1 });
    const open = vi.spyOn(fs, "open");
    await expect(captureMobiResources(directory)).rejects.toThrow(/累计大小/u); expect(open).not.toHaveBeenCalled();
  });
  it.each([5000, 5001])("数量边界%s不先分配资源缓冲区", async count => {
    vi.spyOn(fs, "opendir").mockResolvedValue({ async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i++) yield { name: i + ".bin", isFile: () => true, isSymbolicLink: () => false };
    } } as unknown as Dir);
    await write("0.bin", "x"); sizes({ [resourcePath("0.bin")]: LIMIT + 1 });
    const open = vi.spyOn(fs, "open");
    await expect(captureMobiResources(directory)).rejects.toThrow(count === 5001 ? /数量/u : /单项大小/u);
    expect(open).not.toHaveBeenCalled();
  });
  it("使用NOFOLLOW（若平台提供），循环处理短读并关闭句柄", async () => {
    await write("x.bin", "abcdef");
    const handle = await originalOpen(resourcePath("x.bin"), "r"), read = handle.read.bind(handle);
    const close = vi.spyOn(handle, "close"), open = vi.spyOn(fs, "open").mockResolvedValue(handle);
    vi.spyOn(handle, "read").mockImplementation(async options => read({ ...options, length: Math.min(options?.length ?? 2, 2) }));
    expect(Buffer.from((await captureMobiResources(directory)).resources[0].bytes).toString()).toBe("abcdef");
    expect(open).toHaveBeenCalledWith(resourcePath("x.bin"), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    expect(close).toHaveBeenCalledOnce();
  });
  it("打开前符号链接替换、完成前已读资源再次变化都拒绝", async () => {
    await write("x.bin", "abc");
    for (const stage of [2, 4]) {
      let calls = 0;
      const spy = vi.spyOn(fs, "lstat").mockImplementation(async (name, options) => {
        const stat = await originalLstat(name, options);
        if (String(name) === resourcePath("x.bin") && ++calls === stage) Object.assign(stat, { mode: BigInt(0o120777) });
        return stat;
      });
      await expect(captureMobiResources(directory)).rejects.toThrow(/变化/u); spy.mockRestore();
    }
  });
  it.each(["size", "mtimeNs", "ctimeNs"] as const)("读取后%s变化必须拒绝且关闭句柄", async field => {
    await write("x.bin", "abc");
    const handle = await originalOpen(resourcePath("x.bin"), "r"), close = vi.spyOn(handle, "close");
    const before = await handle.stat({ bigint: true }), after = await handle.stat({ bigint: true }); after[field] += BigInt(1);
    vi.spyOn(fs, "open").mockResolvedValue(handle);
    vi.spyOn(handle, "stat").mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    await expect(captureMobiResources(directory)).rejects.toThrow(/变化/u); expect(close).toHaveBeenCalledOnce();
  });
  it.each(["before-open", "before-read", "after-read", "path-after-read", "ancestor", "short-read"])("拒绝读取期间变化：%s", async phase => {
    await write("x.bin", "abc");
    const handle = await originalOpen(resourcePath("x.bin"), "r"), close = vi.spyOn(handle, "close");
    vi.spyOn(fs, "open").mockResolvedValue(handle);
    const stat = await handle.stat({ bigint: true }), changed = await handle.stat({ bigint: true }); changed.ino += BigInt(1);
    if (phase === "before-read" || phase === "after-read") {
      let calls = 0; vi.spyOn(handle, "stat").mockImplementation(async () => (++calls === (phase === "before-read" ? 1 : 2) ? changed : stat));
    } else if (phase === "short-read") vi.spyOn(handle, "read").mockImplementation(async options => ({ buffer: options?.buffer ?? new Uint8Array(0), bytesRead: 0 }));
    else {
      let calls = 0; vi.spyOn(fs, "lstat").mockImplementation(async (name, options) => {
        const current = await originalLstat(name, options);
        if ((phase === "ancestor" ? String(name) === directory : String(name) === resourcePath("x.bin"))
          && ++calls === (phase === "path-after-read" ? 3 : 2)) Object.assign(current, { ino: BigInt(current.ino) + BigInt(1) });
        return current;
      });
    }
    try { await expect(captureMobiResources(directory)).rejects.toThrow(/变化|提前结束/u); }
    finally { if (!close.mock.calls.length) await handle.close(); }
    expect(close).toHaveBeenCalledOnce();
  });
});
