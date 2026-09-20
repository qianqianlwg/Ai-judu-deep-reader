// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inspectMobiContainer, isMobiExtension, mobiSourceHref } from "./mobi-format";

const TEXT = Buffer.from("<html><body><p>有界容器正文。</p></body></html>");
const NONE = 0xffffffff;
type HeaderOptions = {
  version?: number; headerLength?: number; compression?: number; encoding?: number; encryption?: number;
  textLength?: number; textRecordCount?: number; recordSize?: number; exth?: Buffer;
};

function integer(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}

function exth(entries: readonly (readonly [number, Buffer])[] = [], padding = 0): Buffer {
  const records = entries.map(([type, data]) => {
    const result = Buffer.alloc(8 + data.length);
    result.writeUInt32BE(type, 0);
    result.writeUInt32BE(result.length, 4);
    data.copy(result, 8);
    return result;
  });
  const result = Buffer.alloc(12 + records.reduce((sum, record) => sum + record.length, 0) + padding);
  result.write("EXTH", 0, "ascii");
  result.writeUInt32BE(result.length, 4);
  result.writeUInt32BE(records.length, 8);
  Buffer.concat(records).copy(result, 12);
  return result;
}

function header(options: HeaderOptions = {}): Buffer {
  const version = options.version ?? 6;
  const headerLength = options.headerLength ?? (version === 8 ? 264 : 232);
  const extra = options.exth ?? Buffer.alloc(0);
  const title = Buffer.from("容器预检");
  const titleOffset = 16 + headerLength + extra.length;
  const result = Buffer.alloc(titleOffset + title.length);
  result.writeUInt16BE(options.compression ?? 1, 0);
  result.writeUInt32BE(options.textLength ?? TEXT.length, 4);
  result.writeUInt16BE(options.textRecordCount ?? 1, 8);
  result.writeUInt16BE(options.recordSize ?? 4096, 10);
  result.writeUInt16BE(options.encryption ?? 0, 12);
  result.write("MOBI", 16, "ascii");
  result.writeUInt32BE(headerLength, 20);
  result.writeUInt32BE(2, 24);
  result.writeUInt32BE(options.encoding ?? 65001, 28);
  result.writeUInt32BE(version, 36);
  result.writeUInt32BE(titleOffset, 84);
  result.writeUInt32BE(title.length, 88);
  result.writeUInt32BE(NONE, 108);
  result.writeUInt32BE(options.exth ? 0x40 : 0, 128);
  result.writeUInt32BE(NONE, 168);
  result.writeUInt32BE(NONE, 244);
  extra.copy(result, 16 + headerLength);
  title.copy(result, titleOffset);
  return result;
}

function pdb(records: readonly Uint8Array[], gap = 2): Buffer {
  const directory = Buffer.alloc(78 + records.length * 8 + gap);
  directory.write("BOOKMOBI", 60, "ascii");
  directory.writeUInt16BE(records.length, 76);
  let cursor = directory.length;
  records.forEach((record, index) => {
    directory.writeUInt32BE(cursor, 78 + index * 8);
    cursor += record.length;
  });
  return Buffer.concat([directory, ...records]);
}

function single(options: HeaderOptions = {}, text = TEXT): Buffer {
  return pdb([header(options), text]);
}

function dual(pointer = 3, secondary: HeaderOptions = {}): Buffer {
  return pdb([header({ exth: exth([[121, integer(pointer)]]) }), TEXT,
    Buffer.from("BOUNDARY"), header({ version: 8, ...secondary }), TEXT]);
}

function start(input: Buffer, index = 0): number { return input.readUInt32BE(78 + index * 8); }
function set32(input: Buffer, offset: number, value: number, index = 0): void {
  input.writeUInt32BE(value, start(input, index) + offset);
}
function set16(input: Buffer, offset: number, value: number, index = 0): void {
  input.writeUInt16BE(value, start(input, index) + offset);
}

// WHY：样本完全手造，不通过待测实现反向生成；不导入第三方解析器，不把头部通过当作正文可解析。
describe("MOBI容器预检：合法头部及证据", () => {
  it.each([6, 7])("支持无 EXTH 的 MOBI %i", version => {
    const input = single({ version });
    const result = inspectMobiContainer(input);
    expect(result).toMatchObject({ kind: "mobi", version, headerRecordIndex: 0, recordCount: 2,
      headerLength: 232, textLength: TEXT.length, textRecordCount: 1, recordSize: 4096,
      textStartRecordIndex: 1, textEndRecordIndex: 2, encryption: 0, isDual: false,
      compression: 1, encoding: 65001, drm: { offset: NONE, count: 0, size: 0, flags: 0 } });
    expect(result.exth).toBeUndefined();
    expect(result.headers).toHaveLength(1);
    expect(result.recordOffsets).toEqual([start(input), start(input, 1)]);
    expect(result.recordStart).toBe(start(input));
    expect(result.recordEnd).toBe(start(input, 1));
  });

  it("支持 pure KF8 和 EXTH 121无次头哨兵", () => {
    for (const extra of [undefined, exth([[121, integer(NONE)]])]) {
      const result = inspectMobiContainer(single({ version: 8, exth: extra }));
      expect(result).toMatchObject({ kind: "kf8", version: 8, headerLength: 264, headerRecordIndex: 0, isDual: false });
    }
    expect(inspectMobiContainer(single({ exth: exth([[121, integer(NONE)]]) })).kind).toBe("mobi");
  });


  it("接受恰好覆盖本地KF8字段的248字节MOBI头", () => {
    const full = header({ version: 8 });
    const minimal = Buffer.concat([full.subarray(0, 264), full.subarray(280)]);
    minimal.writeUInt32BE(248, 20);
    minimal.writeUInt32BE(264, 84);
    expect(inspectMobiContainer(pdb([minimal, TEXT]))).toMatchObject({ kind: "kf8", headerLength: 248 });
  });
  it.each([2, 3])("按实际边界识别 dual，EXTH 121=%i", pointer => {
    const input = dual(pointer);
    const result = inspectMobiContainer(input);
    expect(result).toMatchObject({ kind: "kf8", version: 8, isDual: true, recordCount: 5,
      headerRecordIndex: 3, boundaryRecordIndex: 2, recordStart: start(input, 3), recordEnd: start(input, 4),
      textStartRecordIndex: 4, textEndRecordIndex: 5, boundaryPointerKind: pointer === 2 ? "marker" : "header" });
    expect(result.headers.map(item => [item.kind, item.headerRecordIndex])).toEqual([["mobi", 0], ["kf8", 3]]);
    expect(result.headers[0].exth).toMatchObject({ offset: start(input) + 248, length: 24,
      recordCount: 1, kf8BoundaryRecordIndex: pointer });
  });

  it("允许资源记录位于旧正文与 BOUNDARY 之间", () => {
    const input = pdb([header({ exth: exth([[121, integer(4)]]) }), TEXT, Buffer.from("resource"),
      Buffer.from("BOUNDARY"), header({ version: 8 }), TEXT]);
    expect(inspectMobiContainer(input)).toMatchObject({ headerRecordIndex: 4, boundaryRecordIndex: 3 });
  });

  it.each([1252, 65001])("明确支持编码 %i", encoding => {
    expect(inspectMobiContainer(single({ encoding })).encoding).toBe(encoding);
  });

  it.each([1, 2, 17480])("只识别压缩枚举 %i，不执行或担保解压", compression => {
    expect(inspectMobiContainer(single({ compression })).compression).toBe(compression);
  });

  it("支持空 EXTH、未知条目及至多三个零填充字节", () => {
    for (const extra of [exth(), ...[0, 1, 2, 3].map(padding => exth([[999, Buffer.from("test")]], padding))]) {
      expect(inspectMobiContainer(single({ exth: extra })).exth?.length).toBe(extra.length);
    }
  });

  it("不修改输入，记录偏移相对于 Uint8Array 视图而非底层 buffer", () => {
    const base = single();
    const larger = Buffer.concat([Buffer.alloc(17, 255), base, Buffer.alloc(23, 255)]);
    const view = new Uint8Array(larger.buffer, larger.byteOffset + 17, base.length);
    const before = Buffer.from(view);
    expect(inspectMobiContainer(view).recordStart).toBe(start(base));
    expect(Buffer.from(view)).toEqual(before);
    expect(inspectMobiContainer(pdb([header(), TEXT], 0)).recordStart).toBe(94);
  });
});

describe("PDB及记录内边界", () => {
  it.each([0, 60, 77, 78, 85, 93])("拒绝截断目录，长度 %i", length => {
    expect(() => inspectMobiContainer(single().subarray(0, length))).toThrow();
  });

  it("任意截断未压缩单格式或双格式文件都不放行", () => {
    for (const input of [single(), dual()]) {
      for (let length = 0; length < input.length; length++) {
        expect(() => inspectMobiContainer(input.subarray(0, length))).toThrow();
      }
    }
  });
  it.each([60, 64])("拒绝错误的 PDB magic @%i", offset => {
    const input = single(); input[offset] = 0;
    expect(() => inspectMobiContainer(input)).toThrow("BOOK/MOBI");
  });
  it.each([0, 1, 65535])("拒绝不合理的目录记录数 %i", count => {
    const input = single(); input.writeUInt16BE(count, 76);
    expect(() => inspectMobiContainer(input)).toThrow();
  });
  it("拒绝 resource database 和后续目录", () => {
    const resource = single(); resource.writeUInt16BE(1, 32);
    const chained = single(); chained.writeUInt32BE(78, 72);
    for (const input of [resource, chained]) expect(() => inspectMobiContainer(input)).toThrow("记录目录");
  });
  it.each(["目录内", "等于文件长度", "大于文件长度", "相等", "倒序"])("拒绝%s的 offset", mode => {
    const input = single();
    if (mode === "目录内") input.writeUInt32BE(93, 78);
    if (mode === "等于文件长度") input.writeUInt32BE(input.length, 86);
    if (mode === "大于文件长度") input.writeUInt32BE(NONE, 86);
    if (mode === "相等") input.writeUInt32BE(start(input), 86);
    if (mode === "倒序") input.writeUInt32BE(start(input) - 1, 86);
    expect(() => inspectMobiContainer(input)).toThrow("偏移无效");
  });
  it.each([1, 15, 19, 23, 39, 100, 247])("不能借用下一记录补齐长度 %i 的首头", length => {
    expect(() => inspectMobiContainer(pdb([header().subarray(0, length), TEXT]))).toThrow("边界");
  });
  it.each([0, 4, 23, 100, 231, 4097, NONE])("拒绝 MOBI headerLength=%i", length => {
    const input = single(); set32(input, 20, length);
    expect(() => inspectMobiContainer(input)).toThrow("头长度");
  });
  it("拒绝 MOBI magic、跨记录头和 KF8短头", () => {
    const magic = single(); magic[start(magic) + 16] = 0;
    expect(() => inspectMobiContainer(magic)).toThrow("MOBI 头部");
    const crossing = single(); set32(crossing, 20, start(crossing, 1) - start(crossing));
    expect(() => inspectMobiContainer(crossing)).toThrow("MOBI头部超出边界");
    const short = single({ version: 8 }); set32(short, 20, 232);
    expect(() => inspectMobiContainer(short)).toThrow("头长度");
  });
  it("标题也不得跨记录或与头重叠", () => {
    const outside = single(); set32(outside, 84, start(outside, 1) - start(outside) - 1);
    expect(() => inspectMobiContainer(outside)).toThrow("标题超出边界");
    const overlap = single(); set32(overlap, 84, 200);
    expect(() => inspectMobiContainer(overlap)).toThrow("标题与头部重叠");
  });
  it("头记录本身有独立预算", () => {
    expect(() => inspectMobiContainer(pdb([Buffer.concat([header(), Buffer.alloc(1024 * 1024)]), TEXT])))
      .toThrow("头记录超过预检大小上限");
  });
});

describe("版本、编码及正文预算", () => {
  it.each([0, 1, 5, 9, 10, NONE])("拒绝未支持/未来版本 %i", version => {
    expect(() => inspectMobiContainer(single({ version }))).toThrow("版本");
  });
  it.each([0, 932, 1200, 65002, NONE])("拒绝未知编码 %i", encoding => {
    expect(() => inspectMobiContainer(single({ encoding }))).toThrow("编码");
  });
  it.each([0, 3, 65535])("拒绝未知压缩 %i", compression => {
    expect(() => inspectMobiContainer(single({ compression }))).toThrow("压缩");
  });
  it.each([0, 4097, 20 * 1024 * 1024 + 1, NONE])("拒绝无效或超预算正文长度 %i", textLength => {
    expect(() => inspectMobiContainer(single({ textLength }))).toThrow("正文长度");
  });
  it.each([0, 2, 16385, 65535])("拒绝无效或超预算正文数 %i", textRecordCount => {
    expect(() => inspectMobiContainer(single({ textRecordCount }))).toThrow("正文记录数");
  });
  it.each([0, 4097, 65535])("拒绝 recordSize=%i", recordSize => {
    expect(() => inspectMobiContainer(single({ recordSize }))).toThrow("recordSize");
  });
  it("未压缩正文必须足以容纳声明长度，压缩正文不在此处解码", () => {
    expect(() => inspectMobiContainer(single({ textLength: TEXT.length + 1 }))).toThrow("未压缩正文");
    expect(inspectMobiContainer(single({ compression: 2, textLength: 4096 })).textLength).toBe(4096);
    expect(inspectMobiContainer(single({ textLength: 1, recordSize: 1 }, Buffer.from("x"))).recordSize).toBe(1);
  });

  it("输入超过100MiB在目录解析前拒绝", () => {
    expect(() => inspectMobiContainer(new Uint8Array(100 * 1024 * 1024 + 1))).toThrow("文件超过预检大小上限");
  });
  it("20MiB声明的上限可通过，不能用超容量声明绕过", () => {
    const count = 5120;
    const records = Array.from({ length: count }, () => Buffer.from([65]));
    const valid = pdb([header({ compression: 2, textRecordCount: count, textLength: 20 * 1024 * 1024 }), ...records]);
    expect(inspectMobiContainer(valid).textLength).toBe(20 * 1024 * 1024);
    set32(valid, 4, 20 * 1024 * 1024 + 1);
    expect(() => inspectMobiContainer(valid)).toThrow("正文长度");
  });
  it("正文物理记录和聚合存储有独立预算", () => {
    expect(() => inspectMobiContainer(single({}, Buffer.alloc(65537)))).toThrow("存储记录");
    const records = Array.from({ length: 321 }, () => Buffer.alloc(65536));
    expect(() => inspectMobiContainer(pdb([header({ textRecordCount: records.length }), ...records]))).toThrow("存储总量");
  });
});

describe("EXTH严格长度及计数", () => {
  it.each([
    ["总长度过小", 4, 11], ["总长度超预算", 4, NONE], ["总长度越界", 4, 100],
    ["计数过多", 8, NONE], ["计数超预算", 8, 1025], ["计数过少", 8, 0],
    ["条目零长度", 16, 0], ["条目小于头", 16, 7], ["条目越界", 16, 40],
    ["条目超整数", 16, NONE],
  ] as const)("拒绝%s", (_name, offset, value) => {
    const extra = exth([[999, Buffer.from("data")]]); extra.writeUInt32BE(value, offset);
    expect(() => inspectMobiContainer(single({ exth: extra }))).toThrow("EXTH");
  });
  it("不从同记录的标题或下一记录补齐 EXTH及条目", () => {
    const extra = exth([[999, Buffer.from("data")]]); extra.writeUInt32BE(13, 16);
    expect(() => inspectMobiContainer(single({ exth: extra }))).toThrow("EXTH条目超出边界");
    const input = single({ exth: exth() });
    set32(input, 252, start(input, 1) - start(input) - 248 + 1);
    expect(() => inspectMobiContainer(input)).toThrow("EXTH区间超出边界");
    expect(() => inspectMobiContainer(pdb([header({ exth: exth() }).subarray(0, 259), TEXT]))).toThrow("EXTH头部");
  });
  it("拒绝 EXTH错误magic、条目计数溢出及隐藏数据", () => {
    const magic = exth(); magic[0] = 0;
    const missing = exth([[999, Buffer.alloc(16)]]); missing.writeUInt32BE(2, 8);
    const hidden = exth([], 1); hidden[12] = 1;
    for (const extra of [magic, missing, hidden, exth([], 4)]) {
      expect(() => inspectMobiContainer(single({ exth: extra }))).toThrow("EXTH");
    }
  });
  it.each([0, 1, 2, 3, 5])("EXTH121数据必须恰好4字节，拒绝 %i 字节", length => {
    expect(() => inspectMobiContainer(single({ exth: exth([[121, Buffer.alloc(length)]]) }))).toThrow("整数条目长度");
  });

  it("EXTH计数预算独立于可容纳的字节数", () => {
    const entries = Array.from({ length: 1024 }, () => [999, Buffer.alloc(0)] as const);
    expect(inspectMobiContainer(single({ exth: exth(entries) })).exth?.recordCount).toBe(1024);
    entries.push([999, Buffer.alloc(0)]);
    expect(() => inspectMobiContainer(single({ exth: exth(entries) }))).toThrow("EXTH记录数");
  });
  it("拒绝重复 EXTH121，即使内容相同或为无次头哨兵", () => {
    expect(() => inspectMobiContainer(single({ exth: exth([[121, integer(NONE)], [121, integer(NONE)]]) })))
      .toThrow("121不能重复");
  });
});

describe("双格式不能绕过次头检查", () => {
  it.each([0, 1, 4, 5, NONE - 1])("拒绝不指向有效边界/次头的 EXTH121=%i", pointer => {
    expect(() => inspectMobiContainer(dual(pointer))).toThrow();
  });
  it("不只凭 MOBI magic猜测第二个头，必须有独立完整边界", () => {
    for (const marker of [Buffer.from("NOTBOUND"), Buffer.from("BOUNDARYx"), Buffer.from("BOUNDAR")]) {
      const input = pdb([header({ exth: exth([[121, integer(3)]]) }), TEXT, marker, header({ version: 8 }), TEXT]);
      expect(() => inspectMobiContainer(input)).toThrow("BOUNDARY");
    }
    const last = pdb([header({ exth: exth([[121, integer(2)]]) }), TEXT, Buffer.from("BOUNDARY")]);
    expect(() => inspectMobiContainer(last)).toThrow("索引超出边界");
  });
  it.each([6, 7, 9])("次头不能是版本 %i", version => {
    expect(() => inspectMobiContainer(dual(3, { version }))).toThrow("版本");
  });
  it.each([2, 3])("旧正文数 %i 不能覆盖 BOUNDARY/次头", count => {
    const input = dual(); set16(input, 8, count);
    expect(() => inspectMobiContainer(input)).toThrow("越过格式边界");
  });
  it("次头正文范围、EXTH和头长度均重新校验", () => {
    expect(() => inspectMobiContainer(dual(3, { textRecordCount: 2 }))).toThrow("正文记录数");
    const extra = exth(); extra.writeUInt32BE(99, 4);
    expect(() => inspectMobiContainer(dual(3, { exth: extra }))).toThrow("EXTH");
    const input = dual(); set32(input, 20, 300, 3);
    expect(() => inspectMobiContainer(input)).toThrow("MOBI头部超出边界");
  });
  it("KF8不能通过 EXTH121继续串链或指回首头", () => {
    for (const pointer of [0, 2, 3]) {
      expect(() => inspectMobiContainer(dual(3, { exth: exth([[121, integer(pointer)]]) }))).toThrow("不能再声明");
    }
  });

  it("EXTH121指向BOUNDARY标记时同样不能隐藏加密次头", () => {
    expect(() => inspectMobiContainer(dual(2, { encryption: 2 }))).toThrow("不会绕过 DRM");
  });
  it.each([0, 3])("头记录 %i 的任何非零 PalmDOC encryption都拒绝", index => {
    for (const flag of [1, 2, 255, 65535]) {
      const input = dual(); set16(input, 12, flag, index);
      expect(() => inspectMobiContainer(input)).toThrow("不会绕过 DRM");
    }
  });
  it.each([168, 172, 176, 180])("两个头的 DRM字段 @%i 都检查，不依赖 encryption", offset => {
    for (const index of [0, 3]) {
      const input = dual(); set32(input, offset, 1, index);
      expect(() => inspectMobiContainer(input)).toThrow("不会绕过 DRM");
    }
  });

  it("按完整头布局读取DRM：record164不是DRM，168才是offset", () => {
    for (const index of [0, 3]) {
      const input = dual();
      set32(input, 164, 12345, index); // Calibre writer8 的 unknown_index。
      set32(input, 168, NONE, index);
      set32(input, 172, NONE, index); // 无DRM时 count 也可采用哨兵。
      expect(inspectMobiContainer(input).headers.find(item => item.headerRecordIndex === index)?.drm)
        .toEqual({ offset: NONE, count: NONE, size: 0, flags: 0 });
      set32(input, 176, 16, index);
      expect(() => inspectMobiContainer(input)).toThrow("DRM");
    }
  });
  it("兼容无DRM的零偏移，但不忽略 sentinel偏移后的非零计数", () => {
    const input = single(); set32(input, 168, 0);
    expect(inspectMobiContainer(input).drm.offset).toBe(0);
    const invalid = single(); set32(invalid, 172, 1);
    expect(() => inspectMobiContainer(invalid)).toThrow("DRM");
  });
});

describe("libmobi样本头布局的独立回归", () => {
  // WHY：复现固定上游样本的字段组合，不依赖忽略目录，不复制书籍内容，也不冒充可解压的KF8正文。
  // 来源：libmobi commit 906274205c11944b628da1c553b255acb1af7c55；2026-09-20本地逐字段交叉核验。
  it.each([
    ["sample-unicode-uncompressed.mobi", 1, 41, 93],
    ["sample-unicode-huffdic.mobi", 17480, 45, 101],
    ["sample-ncx.mobi", 2, 11, 26],
  ] as const)("复现%s的头长、压缩和边界组合", (_name, compression, boundary, count) => {
    const primary = header({ version: 6, headerLength: 264, compression, exth: exth([[121, integer(boundary + 1)]]) });
    const secondary = header({ version: 8, compression });
    primary.writeUInt32BE(NONE, 164); secondary.writeUInt32BE(NONE, 164);
    const records = [primary, TEXT];
    while (records.length < boundary) records.push(Buffer.from("resource"));
    records.push(Buffer.from("BOUNDARY"), secondary, TEXT);
    while (records.length < count) records.push(Buffer.from("resource"));
    const result = inspectMobiContainer(pdb(records));
    expect(result).toMatchObject({ kind: "kf8", version: 8, compression, isDual: true, recordCount: count,
      boundaryRecordIndex: boundary, headerRecordIndex: boundary + 1, boundaryPointerKind: "header" });
    expect(result.headers[0]).toMatchObject({ kind: "mobi", version: 6, headerLength: 264,
      exth: { kf8BoundaryRecordIndex: boundary + 1 }, drm: { offset: NONE, count: 0, size: 0, flags: 0 } });
    expect(result.headers[1]).toMatchObject({ kind: "kf8", headerLength: 264,
      drm: { offset: NONE, count: 0, size: 0, flags: 0 } });
  });
});

describe("稳定导出", () => {
  it("保留扩展名类型守卫和来源编码", () => {
    for (const value of [".mobi", ".azw", ".azw3"]) expect(isMobiExtension(value)).toBe(true);
    for (const value of [".prc", "mobi", ".MOBI", ".epub", ""]) expect(isMobiExtension(value)).toBe(false);
    expect(mobiSourceHref("mobi", "章/1#段")).toBe(`mobi-v1/mobi/${encodeURIComponent("章/1#段")}`);
    expect(mobiSourceHref("kf8", "0")).toBe("mobi-v1/kf8/0");
  });
});
