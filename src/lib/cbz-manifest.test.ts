import { describe, expect, it } from "vitest";
import { cbzPages, cbzSourceHref, isCbzFormat, CBZ_MAX_PAGES, type CbzEntry } from "./cbz-manifest";
const files = (names: readonly string[]): CbzEntry[] => names.map(name => ({ name, directory: false }));
const namesOf = (names: readonly string[]) => cbzPages(files(names)).map(page => page.name);

describe("CBZ自然页序及来源定位", () => {
  it("数字页序不使用字符串字典序，输入数组不被修改", () => {
    const entries = files(["10.jpg", "2.jpg", "1.jpg", "20.jpg"]), before = JSON.stringify(entries);
    expect(cbzPages(entries).map(page => page.name)).toEqual(["1.jpg", "2.jpg", "10.jpg", "20.jpg"]); expect(JSON.stringify(entries)).toBe(before);
  });
  it("目录和文件内多个数字段都按自然顺序比较", () => {
    expect(namesOf(["vol10/page1.jpg", "vol2/page10.jpg", "vol2/page2.jpg", "vol1/page9.jpg", "vol2/page1.jpg"]))
      .toEqual(["vol1/page9.jpg", "vol2/page1.jpg", "vol2/page2.jpg", "vol2/page10.jpg", "vol10/page1.jpg"]);
  });
  it("超出Number精度的连续页号仍逐位区分，不能用Number相减排序", () => {
    const prefix = "987654321098765432109876543210", lower = prefix + "2", higher = prefix + "3";
    expect(Number(lower)).toBe(Number(higher));
    expect(namesOf([`p${higher}.png`, `p${lower}.png`, "p10000000000000000000000000000000000.png", "p9.png"]))
      .toEqual(["p9.png", `p${lower}.png`, `p${higher}.png`, "p10000000000000000000000000000000000.png"]);
  });
  it("数值段长度比大小先于字典序，包含数百位数字", () => {
    const short = "9".repeat(400), long = "1" + "0".repeat(400);
    expect(namesOf([`p${long}.jpg`, `p${short}.jpg`])).toEqual([`p${short}.jpg`, `p${long}.jpg`]);
  });
  it("leadingzero数值相等时有稳定字面次序，不依赖归档写入顺序", () => {
    const input = ["p2.png", "p0002.png", "p02.png", "p1.png", "p10.png"], expected = ["p1.png", "p0002.png", "p02.png", "p2.png", "p10.png"];
    expect(namesOf(input)).toEqual(expected); expect(namesOf([...input].reverse())).toEqual(expected);
  });
  it("全零数字段不变为空值而丢失页，大小写稳定但保留原始名字", () => {
    const input = ["p0.PNG", "P0.png", "p00.png", "p1.png"];
    expect(namesOf(input)).toEqual(["P0.png", "p0.PNG", "p00.png", "p1.png"]); expect(namesOf([...input].reverse())).toEqual(namesOf(input));
  });
  it("自然序归一化不改真实ZIP名和sourceHref，大小写不同页不去重", () => {
    const names = ["PAGE2.JPG", "page2.jpg", "page10.JpEg", "page1.WEBP"];
    const result = cbzPages(files(names)); expect(new Set(result.map(page => page.name)).size).toBe(4);
    expect(result.map(page => page.page)).toEqual([1, 2, 3, 4]);
    for (const page of result) { expect(page.sourceHref).toBe(cbzSourceHref(page.name)); expect(page.title).toBe(`第 ${page.page} 页 · ${page.name.split("/").at(-1)}`); }
  });
  it("中文目录、空格、emoji和组合字符编码为可逆来源，不改归档字面路径", () => {
    const input = ["卷一/第 1 页😀.png", "é2.jpg", "e\u03012.jpg"];
    for (const page of cbzPages(files(input))) expect(decodeURIComponent(page.sourceHref.slice("cbz-v1/".length))).toBe(page.name);
    expect(cbzSourceHref("卷一/第 1 页😀.png")).toBe("cbz-v1/%E5%8D%B7%E4%B8%80%2F%E7%AC%AC%201%20%E9%A1%B5%F0%9F%98%80.png");
  });
  it("源href按整个字面文件名编码，百分号不当作预编码路径解码", () => {
    expect(cbzSourceHref("a%2Fb.png")).toBe("cbz-v1/a%252Fb.png"); expect(cbzSourceHref("a/b.png")).not.toBe(cbzSourceHref("a%2Fb.png"));
  });
  it.each(["cbz", ".cbz", "CBZ", ".CbZ"])("格式识别 %s", format => { expect(isCbzFormat(format)).toBe(true); });
  it.each(["zip", "book.cbz", "cbz ", "..cbz", "", ".pdf"])("非CBZ格式 %s 不误识别", format => { expect(isCbzFormat(format)).toBe(false); });
});

describe("CBZ清单限额和元数据", () => {
  it("只忽略已知元数据，目录项不算页", () => {
    const entries = [...files(["ComicInfo.xml", ".DS_Store", "nested/.DS_Store", "Thumbs.db", "nested/Thumbs.db", "__MACOSX/metadata", "1.jpg"]), { name: "pictures/", directory: true }];
    expect(cbzPages(entries).map(page => page.name)).toEqual(["1.jpg"]);
  });
  it("__MACOSX中的图片扩展资源叉是已知元数据，不应被误当漫画页", () => {
    expect(namesOf(["1.jpg", "__MACOSX/._1.jpg", "__MACOSX/nested/._2.png"])).toEqual(["1.jpg"]);
  });
  it.each(["README.txt", "page.svg", "page.html", "page.pdf", "script.js", "archive.zip", "page.avif", "page.tiff"])("未知或主动文件 %s 明确拒绝，不静默丢弃", name => {
    expect(() => cbzPages(files(["1.png", name]))).toThrow(/不支持的文件/);
  });
  it("完整重复文件名即使是元数据也拒绝，避免同名覆盖", () => {
    expect(() => cbzPages(files(["1.jpg", "1.jpg"]))).toThrow(/重复文件名/);
    expect(() => cbzPages(files(["1.jpg", "ComicInfo.xml", "ComicInfo.xml"]))).toThrow(/重复文件名/);
  });
  it.each([[], ["ComicInfo.xml", ".DS_Store"]].map(names => ({ names })))("没有真实图片页 $names 明确反馈", ({ names }) => {
    expect(() => cbzPages(files(names))).toThrow(/没有支持的图片页/);
  });
  it("1000页恰好允许且没有截断，1001页整体拒绝", () => {
    const input = Array.from({ length: CBZ_MAX_PAGES }, (_, i) => `${i + 1}.jpg`).reverse(), pages = cbzPages(files(input));
    expect(pages).toHaveLength(1000); expect(pages[0].name).toBe("1.jpg"); expect(pages.at(-1)?.page).toBe(1000);
    expect(() => cbzPages(files([...input, "1001.jpg"]))).toThrow(/1000页上限/);
  });
});
