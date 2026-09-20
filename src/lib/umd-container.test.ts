import { describe, expect, it } from "vitest";
import { inspectUmdContainer, decodeUmdText, UMD_LIMITS } from "./umd-container";
import { makeUmdFixture, umdData, umdSection, umdNumbers } from "./umd-fixture";

function entries(bytes: Buffer): Buffer[] {
  const values = [bytes.subarray(0, 4)]; let offset = 4;
  while (offset < bytes.length) { const size = bytes[offset] === 0x23 ? bytes[offset + 4] : bytes.readUInt32LE(offset + 5); values.push(bytes.subarray(offset, offset + size)); offset += size; }
  return values;
}
function replace(type: number, replacement?: Buffer): Buffer {
  const records = entries(makeUmdFixture()).filter(record => !(record[0] === 0x23 && record.readUInt16LE(1) === 0x0c));
  const index = records.findIndex(record => record[0] === 0x23 && record.readUInt16LE(1) === type);
  if (replacement) records[index] = replacement; else records.splice(index, 1);
  const body = Buffer.concat(records); return Buffer.concat([body, umdSection(0x0c, umdNumbers([body.length + 9]))]);
}
function replaceData(id: number, payload: Buffer): Buffer {
  const records = entries(makeUmdFixture()).slice(0, -1);
  const index = records.findIndex(record => record[0] === 0x24 && record.readUInt32LE(1) === id);
  records[index] = umdData(id, payload); const body = Buffer.concat(records);
  return Buffer.concat([body, umdSection(0x0c, umdNumbers([body.length + 9]))]);
}

describe("UMD容器严格边界", () => {
  it("索引表仅校验成员，正序或逆序表都保留相同的物理正文顺序", () => {
    const first = inspectUmdContainer(makeUmdFixture({ indexOrder: [0, 1] })), second = inspectUmdContainer(makeUmdFixture({ indexOrder: [1, 0] }));
    expect(first).toEqual(second); expect(first.title).toBe("UMD本地自造样本"); expect(first.titles).toEqual(["第一章 🐉", "第二章"]);
    expect(first.offsets[0]).toBe(0); expect(first.offsets[1] % 2).toBe(0); expect(first.compressed).toHaveLength(2);
  });
  it("每一个截断位置都必须失败，不能把有效前缀当完整文件", () => {
    const bytes = makeUmdFixture(); for (let index = 0; index < bytes.length; index++) expect(() => inspectUmdContainer(bytes.subarray(0, index)), String(index)).toThrow();
  });
  it.each([2, 3, 0, 255])("不把非文字型%d转换为文字而丢资源", kind => {
    expect(() => inspectUmdContainer(makeUmdFixture({ kind }))).toThrow("文字型");
  });
  it.each([0xf0, 0xf1, 0x0e, 0x0f, 0x8888])("保护/未知字段0x%s明确拒绝", type => {
    expect(() => inspectUmdContainer(replace(2, umdSection(type, Buffer.alloc(4))))).toThrow(/验收|授权/u);
  });
  it("未经证实的标志位不直接忽略", () => expect(() => inspectUmdContainer(replace(2, umdSection(2, Buffer.from("名", "utf16le"), 1)))).toThrow("标志"));
  it("拒绝重复元数据、起始版本缺失及尾随字节", () => {
    expect(() => inspectUmdContainer(replace(3, umdSection(2, Buffer.from("名", "utf16le"))))).toThrow("重复");
    expect(() => inspectUmdContainer(replace(1))).toThrow("版本");
    expect(() => inspectUmdContainer(Buffer.concat([makeUmdFixture(), Buffer.from([0])]))).toThrow();
  });
  it.each([0, 1, UMD_LIMITS.text + 2, 0xffffffff])("声明大小%d不能绕过预算", value => {
    expect(() => inspectUmdContainer(replace(0x0b, umdSection(0x0b, umdNumbers([value]))))).toThrow(/大小|超限/u);
  });
  it("section长度低于头部或者超出文件均拒绝", () => {
    const bytes = makeUmdFixture(); bytes[8] = 4; expect(() => inspectUmdContainer(bytes)).toThrow("长度");
    const truncated = Buffer.from([0x89, 0x9b, 0x9a, 0xde, 0x23, 1, 0, 0, 255]); expect(() => inspectUmdContainer(truncated)).toThrow("长度");
  });
  it.each([[1, 30], [0, 1], [0, 0], [0, 0xfffffffe]])("拒绝错误章节偏移%s", (...values) => {
    expect(() => inspectUmdContainer(replaceData(0x200, umdNumbers(values)))).toThrow(/偏移/u);
  });
  it("标题/偏移数量和标题单项编码长度必须一致", () => {
    expect(() => inspectUmdContainer(replaceData(0x200, umdNumbers([0])))).toThrow("数量");
    expect(() => inspectUmdContainer(replaceData(0x300, Buffer.from([1, 0])))).toThrow("长度");
    expect(() => inspectUmdContainer(replaceData(0x300, Buffer.from([4, 0, 0])))).toThrow("越界");
    expect(() => inspectUmdContainer(replaceData(0x200, Buffer.alloc(5)))).toThrow("长度");
  });
  it.each([[0x1000, 0x1000], [0x1000, 0x9999], [0x1000]])("正文ID表不能重复、缺块或多块%s", (...ids) => {
    expect(() => inspectUmdContainer(replaceData(0x100, umdNumbers(ids)))).toThrow(/重复|不一致/u);
  });
  it("索引校验ID不符不能作为正文处理", () => {
    expect(() => inspectUmdContainer(replace(0x83, umdSection(0x83, umdNumbers([0xdead]))))).toThrow("校验ID");
    expect(() => inspectUmdContainer(replace(0x83, umdSection(0x83, umdNumbers([0x100]))))).toThrow("重复");
  });
  it("封面声明不得缺数据", () => {
    expect(() => inspectUmdContainer(replace(2, umdSection(0x82, Buffer.concat([Buffer.from([1]), umdNumbers([0x400])]))))).toThrow("封面");
  });
  it("需要完整文件结束标识，且终止大小必须等于真实文件大小", () => {
    expect(() => inspectUmdContainer(makeUmdFixture({ terminator: false }))).toThrow("终止");
    const bytes = makeUmdFixture(); bytes.writeUInt32LE(1, bytes.length - 4); expect(() => inspectUmdContainer(bytes)).toThrow("大小");
  });
  it("UTF16严格解码，保留BOM并拒绝奇数字节与孤立代理对", () => {
    expect(decodeUmdText(Buffer.from("\ufeff😀", "utf16le"))).toBe("\ufeff😀");
    expect(() => decodeUmdText(Buffer.from([0]))).toThrow("偶数");
    expect(() => decodeUmdText(Buffer.from([0, 0xd8]))).toThrow("损坏");
  });
});

it.each([0x81, 0x83, 0x84, 0x0c])("已证实writer的0x%s块允许flag=1，其他位仍拒绝", type => {
  const input = makeUmdFixture(); let offset = 4;
  while (offset < input.length) {
    const size = input[offset] === 0x23 ? input[offset + 4] : input.readUInt32LE(offset + 5);
    if (input[offset] === 0x23 && input.readUInt16LE(offset + 1) === type) {
      input[offset + 3] = 1; expect(() => inspectUmdContainer(input)).not.toThrow();
      input[offset + 3] = 2; expect(() => inspectUmdContainer(input)).toThrow("标志"); return;
    } offset += size;
  }
  throw new Error("fixture缺少指定块");
});
