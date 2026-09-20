// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  convertedPositionKey, originalPositionKey, readConvertedPosition, readOriginalPosition, sameReadingAnchor,
  type ConvertedPosition, type ConvertedPositionIdentity,
} from './epub-position';
import { fromRange, joinIndir } from '../../public/vendor/foliate/epubcfi.js';
it('原版位置绑定版本 key 和原文件哈希',()=>{ const value={version:1,originalHash:'hash',cfi:'epubcfi(/6/2)',anchor:{paragraphId:'p',offset:2}};expect(originalPositionKey('e')).toBe('judu:original-position:e');expect(readOriginalPosition(JSON.stringify(value),'hash')).toEqual(value);expect(readOriginalPosition(JSON.stringify(value),'other')).toBeNull();expect(sameReadingAnchor(value.anchor,{paragraphId:'p',offset:2})).toBe(true); });
it('损坏或非法位置不能用于跳转',()=>{const log=vi.spyOn(console,'warn').mockImplementation(()=>{});expect(readOriginalPosition('{','h')).toBeNull();expect(readOriginalPosition('{"version":1,"originalHash":"h","cfi":"https://evil","anchor":null}','h')).toBeNull();expect(readOriginalPosition('{"version":1,"originalHash":"h","cfi":"epubcfi(/6)","anchor":{"paragraphId":"p","offset":-1}}','h')).toBeNull();log.mockRestore();});


const identity: ConvertedPositionIdentity = {
  sourceHash: "a".repeat(64), fileHash: "b".repeat(64), converterVersion: "umd-epub-v1",
};
const position: ConvertedPosition = {
  ...identity, version: 1, kind: "umd-epub", cfi: "epubcfi(/6/2[chapter-0001]!/4/2/1:2)",
  anchor: { paragraphId: "chapter-1-p1", offset: 2 },
};
const saved = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...position, ...patch });
afterEach(() => vi.restoreAllMocks());

describe("转换版位置身份隔离", () => {
  it("独立键不改变原版键，也不截取或归一化版本 ID", () => {
    for (const id of ["edition-1", "书籍:版本/😀", ""]) {
      expect(convertedPositionKey(id)).toBe("judu:converted-position:" + id);
      expect(originalPositionKey(id)).toBe("judu:original-position:" + id);
      expect(convertedPositionKey(id)).not.toBe(originalPositionKey(id));
    }
  });
  it("保留独立双哈希和完整锚点", () => {
    expect(readConvertedPosition(saved(), identity)).toEqual(position);
    expect(readConvertedPosition(saved({ anchor: null }), identity)).toEqual({ ...position, anchor: null });
  });
  it.each([
    ["原件不同", { sourceHash: "c".repeat(64) }],
    ["派生文件不同", { fileHash: "c".repeat(64) }],
    ["双哈希颠倒", { sourceHash: identity.fileHash, fileHash: identity.sourceHash }],
    ["转换器不同", { converterVersion: "umd-epub-v2" }],
  ])("不复用另一身份：%s", (_label, patch) => {
    expect(readConvertedPosition(saved(patch), identity)).toBeNull();
    expect(readConvertedPosition(saved(), { ...identity, ...patch } as ConvertedPositionIdentity)).toBeNull();
  });
  it.each(["umd-epub-v0", "umd-epub-v2", "UMD-EPUB-V1", "umd-epub-v1 ", "", null, 1])(
    "记录和调用方一致也不能接受未知转换器：%s", converterVersion => {
      expect(readConvertedPosition(saved({ converterVersion }), { ...identity, converterVersion } as ConvertedPositionIdentity)).toBeNull();
    },
  );
  it("合法大小写十六进制仍须原样匹配，不擅自归一化身份", () => {
    const uppercase = { ...identity, sourceHash: "A".repeat(64), fileHash: "B".repeat(64) };
    expect(readConvertedPosition(saved(uppercase), uppercase)).toEqual({ ...position, ...uppercase });
    expect(readConvertedPosition(saved(uppercase), identity)).toBeNull();
    const digits = { ...identity, sourceHash: "0123456789abcdef".repeat(4) };
    expect(readConvertedPosition(saved(digits), digits)?.sourceHash).toBe(digits.sourceHash);
  });
  const badHashes: [string, unknown][] = [
    ["缺失", undefined], ["null", null], ["数字", 123], ["数组", []], ["对象", {}],
    ["空串", ""], ["63位", "a".repeat(63)], ["65位", "a".repeat(65)],
    ["非hex", "g".repeat(64)], ["全角", "ａ".repeat(64)],
    ["换行冒充第64位", "a".repeat(63) + "\n"], ["尾换行", "a".repeat(64) + "\n"], ["前空格", " " + "a".repeat(64)],
  ];
  for (const field of ["sourceHash", "fileHash"] as const) {
    it.each(badHashes)(field + " 必须为64hex：%s", (_label, hash) => {
      expect(readConvertedPosition(saved({ [field]: hash }), identity)).toBeNull();
      const invalidIdentity = { ...identity, [field]: hash } as ConvertedPositionIdentity;
      expect(readConvertedPosition(saved(), invalidIdentity)).toBeNull();
      expect(readConvertedPosition(saved({ [field]: hash }), invalidIdentity)).toBeNull();
    });
  }
  it.each([null, [], {}, "identity", 1, { sourceHash: identity.sourceHash }])(
    "运行时不相信伪造的 identity：%j", value => {
      expect(readConvertedPosition(saved(), value as ConvertedPositionIdentity)).toBeNull();
    },
  );
  it("原版记录不能混入转换版，转换版也不能被旧读取器接受", () => {
    const original = { version: 1, originalHash: identity.sourceHash, cfi: position.cfi, anchor: position.anchor };
    const raw = JSON.stringify(original);
    expect(readOriginalPosition(raw, identity.sourceHash)).toEqual(original);
    expect(readConvertedPosition(raw, identity)).toBeNull();
    expect(readConvertedPosition(saved({ originalHash: identity.sourceHash }), identity)).toBeNull();
    expect(readOriginalPosition(saved(), identity.sourceHash)).toBeNull();
  });
});

describe("转换版记录结构和版本", () => {
  it.each([undefined, null, 0, 2, -1, 1.5, "1", true, {}, []])("拒绝版本边界：%j", version => {
    expect(readConvertedPosition(saved({ version }), identity)).toBeNull();
  });
  it.each([undefined, null, "epub", "original", "UMD-EPUB", "umd-epub ", 1])("拒绝错误kind：%j", kind => {
    expect(readConvertedPosition(saved({ kind }), identity)).toBeNull();
  });
  it.each(["null", "[]", "{}", "1", "true", '"position"'])("拒绝非记录JSON：%s", raw => {
    expect(readConvertedPosition(raw, identity)).toBeNull();
  });
  it("拒绝未知字段，不隐式升级记录格式", () => {
    expect(readConvertedPosition(saved({ futureVersion: 2 }), identity)).toBeNull();
    expect(readConvertedPosition(saved({ sourceMap: {} }), identity)).toBeNull();
  });
  it("坏JSON告警并返回null，不抛到阅读器", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ["{", " ", '{"version":1,}', saved() + "garbage"]) {
      expect(readConvertedPosition(raw, identity)).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith("转换版阅读位置损坏，改用精读锚点", expect.any(SyntaxError));
  });
  it("不存在的记录、普通身份失配不误报JSON损坏", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of [null, "", undefined, 42, {}]) {
      expect(readConvertedPosition(raw as string | null, identity)).toBeNull();
    }
    expect(readConvertedPosition(saved({ fileHash: "c".repeat(64) }), identity)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("严格的转换版锚点", () => {
  it.each([
    { paragraphId: "段落😀", offset: 0 },
    { paragraphId: "p".repeat(1024), offset: Number.MAX_SAFE_INTEGER },
  ])("保留合法UTF16标识和安全整数偏移", anchor => {
    expect(readConvertedPosition(saved({ anchor }), identity)?.anchor).toEqual(anchor);
  });
  const invalidAnchors: [string, unknown][] = [
    ["缺失", undefined], ["数组", []], ["空对象", {}], ["字符串", "p"], ["数字", 0],
    ["无段落", { offset: 0 }], ["段落非串", { paragraphId: 12, offset: 0 }],
    ["段落为空", { paragraphId: "", offset: 0 }], ["段落空白", { paragraphId: " \t", offset: 0 }],
    ["段落超长", { paragraphId: "p".repeat(1025), offset: 0 }],
    ["段落控制字符", { paragraphId: "p\u0000", offset: 0 }],
    ["段落孤立高代理", { paragraphId: "p\ud83d", offset: 0 }],
    ["段落孤立低代理", { paragraphId: "p\ude00", offset: 0 }],
    ["无偏移", { paragraphId: "p" }], ["偏移负数", { paragraphId: "p", offset: -1 }],
    ["偏移小数", { paragraphId: "p", offset: 1.1 }], ["偏移字符串", { paragraphId: "p", offset: "0" }],
    ["偏移null", { paragraphId: "p", offset: null }], ["偏移布尔", { paragraphId: "p", offset: false }],
    ["偏移不安全", { paragraphId: "p", offset: Number.MAX_SAFE_INTEGER + 1 }],
    ["偏移无穷", { paragraphId: "p", offset: Infinity }], ["偏移NaN", { paragraphId: "p", offset: NaN }],
    ["未知锚点字段", { paragraphId: "p", offset: 0, page: 1 }],
    ["旧选区结构", { paragraphId: "p", startOffset: 0, endOffset: 2 }],
  ];
  it.each(invalidAnchors)("拒绝损坏锚点：%s", (_label, anchor) => {
    expect(readConvertedPosition(saved({ anchor }), identity)).toBeNull();
  });
});

describe("转换版CFI封装、预算与上游兼容", () => {
  it.each([
    "epubcfi(/6/2)",
    "epubcfi(/6/2[chapter-0001]!/4/2/1:0)",
    "epubcfi(/6/2!/4/2,/1:0,/1:20)",
    "epubcfi(/6/2!/4/2/1,:0,:20)",
    "epubcfi(/6/2!/4/2/1:2[中文 😀,后文;s=b])",
    "epubcfi(/6/2[章^]^(^)^,^;^=^^^[]!/4/2/1:0)",
    "epubcfi(/6/2!/4/2~1.5@20:30)",
  ])("保留合法CFI：%s", cfi => {
    expect(readConvertedPosition(saved({ cfi }), identity)?.cfi).toBe(cfi);
  });
  it("本地Foliate生成的点位与真实范围CFI可恢复", () => {
    const doc = new DOMParser().parseFromString('<p id="句子[]😀">自造中文😀内容。</p><p>下一段。</p>', "text/html");
    const paragraphs = doc.querySelectorAll("p");
    const range = doc.createRange();
    range.setStart(paragraphs[0].firstChild!, 2);
    range.collapse(true);
    const point = joinIndir("epubcfi(/6/2[chapter-0001])", fromRange(range));
    expect(readConvertedPosition(saved({ cfi: point }), identity)?.cfi).toBe(point);
    range.setEnd(paragraphs[0].firstChild!, 8);
    const sameParagraph = joinIndir("epubcfi(/6/2[chapter-0001])", fromRange(range));
    expect(readConvertedPosition(saved({ cfi: sameParagraph }), identity)?.cfi).toBe(sameParagraph);
    range.setEnd(paragraphs[1].firstChild!, 3);
    const acrossParagraphs = joinIndir("epubcfi(/6/2[chapter-0001])", fromRange(range));
    expect(readConvertedPosition(saved({ cfi: acrossParagraphs }), identity)?.cfi).toBe(acrossParagraphs);
  });
  it("8192单位边界可用，8193单位拒绝", () => {
    const prefix = "epubcfi(/6/2[", suffix = "]!/4/2/1:0)";
    const cfi = prefix + "x".repeat(8192 - prefix.length - suffix.length) + suffix;
    expect(cfi).toHaveLength(8192);
    expect(readConvertedPosition(saved({ cfi }), identity)?.cfi).toBe(cfi);
    expect(readConvertedPosition(saved({ cfi: cfi.replace("[x", "[xx") }), identity)).toBeNull();
  });
  it("封装校验不冒充CFI语法或当前书内定位校验", () => {
    // WHY：读取器必须用当前书的 resolveCFI 校验；此处不能猜测 Foliate 的路径语义。
    for (const cfi of ["epubcfi(unresolved)", "epubcfi(/6/999999)", "epubcfi(/6/2!,/4/1:0,/6/1:2)"]) {
      expect(readConvertedPosition(saved({ cfi }), identity)?.cfi).toBe(cfi);
    }
  });
  const invalidCfis: [string, unknown][] = [
    ["缺失", undefined], ["null", null], ["数字", 123], ["对象", {}], ["数组", []], ["空串", ""],
    ["URL", "https://example.com/"], ["脚本URL", "javascript:alert(1)"],
    ["缺闭括号", "epubcfi(/6/2"], ["只有前缀", "epubcfi("], ["空封装", "epubcfi()"],
    ["缺前缀", "/6/2)"], ["前缀大小写", "EPUBCFI(/6/2)"],
    ["尾部多余", "epubcfi(/6/2)extra"], ["前导空白", " epubcfi(/6/2)"],
    ["尾部换行", "epubcfi(/6/2)\n"], ["换行不符合上游封装", "epubcfi(/6/\n2)"],
  ];
  it.each(invalidCfis)("拒绝坏CFI：%s", (_label, cfi) => {
    expect(readConvertedPosition(saved({ cfi }), identity)).toBeNull();
  });
});

describe("原版与锚点比较契约保持兼容", () => {
  it("旧短哈希和null锚点仍可读取，不被转换版严格身份规则影响", () => {
    const original = { version: 1, originalHash: "legacy-hash", cfi: "epubcfi(/6/2)", anchor: null };
    expect(readOriginalPosition(JSON.stringify(original), "legacy-hash")).toEqual(original);
    expect(readOriginalPosition(JSON.stringify(original), "another-hash")).toBeNull();
    expect(readOriginalPosition(null, "legacy-hash")).toBeNull();
  });
  it("旧读取器仍按原有前缀契约读取历史记录，新读取器不会继承宽松校验", () => {
    const cfi = "epubcfi(legacy-incomplete";
    const original = { version: 1, originalHash: "legacy-hash", cfi, anchor: { paragraphId: "p", offset: 0 } };
    expect(readOriginalPosition(JSON.stringify(original), "legacy-hash")).toEqual(original);
    expect(readConvertedPosition(saved({ cfi }), identity)).toBeNull();
  });
  it("锚点比较仍只比较段落与偏移，包括null边界", () => {
    expect(sameReadingAnchor(null, null)).toBe(true);
    expect(sameReadingAnchor(null, position.anchor)).toBe(false);
    expect(sameReadingAnchor(position.anchor, null)).toBe(false);
    expect(sameReadingAnchor(position.anchor, { paragraphId: "chapter-1-p1", offset: 2 })).toBe(true);
    expect(sameReadingAnchor(position.anchor, { paragraphId: "chapter-1-p1", offset: 3 })).toBe(false);
    expect(sameReadingAnchor(position.anchor, { paragraphId: "chapter-1-p2", offset: 2 })).toBe(false);
  });
});
