import { deflateSync } from "node:zlib";
export function umdSection(type: number, payload: Uint8Array, flags = 0): Buffer {
  if (payload.length > 250) throw new Error("fixture section过长");
  const header = Buffer.alloc(5); header[0] = 0x23; header.writeUInt16LE(type, 1); header[3] = flags; header[4] = payload.length + 5;
  return Buffer.concat([header, payload]);
}
export function umdData(id: number, data: Uint8Array): Buffer {
  const header = Buffer.alloc(9); header[0] = 0x24; header.writeUInt32LE(id, 1); header.writeUInt32LE(data.length + 9, 5);
  return Buffer.concat([header, data]);
}
export function umdNumbers(values: readonly number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 4); values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4)); return bytes;
}
export type UmdFixtureOptions = { title?: string; chapters?: { title: string; text: string }[]; cover?: Buffer;
  textParts?: Buffer[]; indexOrder?: number[]; kind?: number; terminator?: boolean };
/** 无第三方书籍内容的自造格式fixture，不冒充真实UMD样本。 */
export function makeUmdFixture(options: UmdFixtureOptions = {}): Buffer {
  const chapters = options.chapters ?? [{ title: "第一章 🐉", text: "中文与emoji😀。\u2029逐字保留 <公式>&符号。\r\n" },
    { title: "第二章", text: "第二段正文。\n结尾。" }];
  const chapterText = chapters.map(chapter => Buffer.from(chapter.text, "utf16le"));
  const text = Buffer.concat(chapterText), parts = options.textParts ?? [text.subarray(0, 15), text.subarray(15)];
  const ids = parts.map((_, index) => 0x1000 + index), offsets: number[] = []; let total = 0;
  for (const bytes of chapterText) { offsets.push(total); total += bytes.length; }
  const titles = Buffer.concat(chapters.flatMap(chapter => { const bytes = Buffer.from(chapter.title, "utf16le"); if (bytes.length > 254) throw new Error("fixture标题过长"); return [Buffer.from([bytes.length]), bytes]; }));
  const order = options.indexOrder ?? parts.map((_, index) => index).reverse();
  const records = [Buffer.from([0x89, 0x9b, 0x9a, 0xde]), umdSection(1, Buffer.from([options.kind ?? 1, 0, 0])),
    umdSection(2, Buffer.from(options.title ?? "UMD本地自造样本", "utf16le")), umdSection(3, Buffer.from("测试作者", "utf16le")),
    umdSection(0x0b, umdNumbers([text.length])), umdSection(0x81, umdNumbers([0x100])), umdData(0x100, umdNumbers(order.map(index => ids[index]))),
    umdSection(0x83, umdNumbers([0x200])), umdData(0x200, umdNumbers(offsets)),
    umdSection(0x84, umdNumbers([0x300])), umdData(0x300, titles),
    // WHY：fixture构造使用同步zlib以稳定生成字节；生产解析始终使用有预算的异步API。
    ...parts.map((part, index) => umdData(ids[index], deflateSync(part))),
  ];
  if (options.cover) records.push(umdSection(0x82, Buffer.concat([Buffer.from([1]), umdNumbers([0x400])])), umdData(0x400, options.cover));
  const body = Buffer.concat(records);
  return options.terminator === false ? body : Buffer.concat([body, umdSection(0x0c, umdNumbers([body.length + 9]))]);
}
