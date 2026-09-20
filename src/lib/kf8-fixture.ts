export type Kf8FdstMode = "none" | "stream";
export type Kf8FixtureOptions = {
  fdst?: Kf8FdstMode;
  title?: string;
};

type TagDescriptor = readonly [tag: number, valuesCount: number, mask: number, end: number];
type IndexEntry = { name: string; control: number; values: readonly number[] };

const NO_RECORD = 0xffffffff;
const PDB_HEADER_SIZE = 78;
const RECORD_ENTRY_SIZE = 8;
const KF8_HEADER_LENGTH = 264;
const TEXT_RECORD_SIZE = 4096;

function varLen(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff) throw new Error("KF8 varlen值超出fixture范围");
  const bytes: number[] = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift(rest & 0x7f);
    rest >>>= 7;
  }
  bytes[bytes.length - 1] |= 0x80;
  return bytes;
}

function writeVarLen(target: Buffer, offset: number, value: number): number {
  const encoded = varLen(value);
  encoded.forEach((byte, index) => { target[offset + index] = byte; });
  return offset + encoded.length;
}

function makeTagx(tags: readonly TagDescriptor[]): Buffer {
  const result = Buffer.alloc(12 + tags.length * 4);
  result.write("TAGX", 0, "ascii");
  result.writeUInt32BE(result.length, 4);
  result.writeUInt32BE(1, 8);
  tags.forEach(([tag, valuesCount, mask, end], index) => {
    const offset = 12 + index * 4;
    result[offset] = tag;
    result[offset + 1] = valuesCount;
    result[offset + 2] = mask;
    result[offset + 3] = end;
  });
  return result;
}

function makeIndexPrimary(tags: readonly TagDescriptor[], numCncx: number): Buffer {
  const tagx = makeTagx(tags);
  const result = Buffer.alloc(192 + tagx.length);
  result.write("INDX", 0, "ascii");
  result.writeUInt32BE(192, 4);
  result.writeUInt32BE(0, 8);
  result.writeUInt32BE(0, 12);
  result.writeUInt32BE(192 + tagx.length, 16);
  result.writeUInt32BE(1, 24);
  result.writeUInt32BE(65001, 28);
  result.writeUInt32BE(1, 36);
  result.writeUInt32BE(numCncx, 52);
  tagx.copy(result, 192);
  return result;
}

function makeIndexEntries(entries: readonly IndexEntry[]): Buffer {
  const idxtOffset = 256;
  const result = Buffer.alloc(idxtOffset + 4 + entries.length * 2);
  result.write("INDX", 0, "ascii");
  result.writeUInt32BE(192, 4);
  result.writeUInt32BE(0, 8);
  result.writeUInt32BE(0, 12);
  result.writeUInt32BE(idxtOffset, 20);
  result.writeUInt32BE(entries.length, 24);
  let cursor = 192;
  entries.forEach((entry, index) => {
    const name = Buffer.from(entry.name, "ascii");
    if (name.length > 255) throw new Error("KF8 INDX条目名称过长");
    const start = cursor;
    result[cursor++] = name.length;
    name.copy(result, cursor);
    cursor += name.length;
    result[cursor++] = entry.control;
    entry.values.forEach(value => { cursor = writeVarLen(result, cursor, value); });
    if (cursor > idxtOffset) throw new Error("KF8 INDX条目超过IDXT前的有界空间");
    result.writeUInt16BE(start, idxtOffset + 4 + index * 2);
  });
  result.write("IDXT", idxtOffset, "ascii");
  return result.subarray(0, Math.max(cursor, idxtOffset + 4 + entries.length * 2));
}

function makeCncx(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const result = Buffer.alloc(varLen(bytes.length).length + bytes.length);
  writeVarLen(result, 0, bytes.length);
  varLen(bytes.length).forEach((byte, index) => { result[index] = byte; });
  bytes.copy(result, varLen(bytes.length).length);
  return result;
}

function makeFdst(starts: readonly (readonly [number, number])[]): Buffer {
  const result = Buffer.alloc(12 + starts.length * 8);
  result.write("FDST", 0, "ascii");
  result.writeUInt32BE(12, 4);
  result.writeUInt32BE(starts.length, 8);
  starts.forEach(([start, end], index) => {
    result.writeUInt32BE(start, 12 + index * 8);
    result.writeUInt32BE(end, 16 + index * 8);
  });
  return result;
}

function makeHeader(title: string, textLength: number, fdstIndex: number, numFdst: number, fragIndex: number, skelIndex: number, guideIndex: number): Buffer {
  const titleBytes = Buffer.from(title, "utf8");
  const titleOffset = 16 + KF8_HEADER_LENGTH;
  const result = Buffer.alloc(titleOffset + titleBytes.length);
  result.writeUInt16BE(1, 0);
  result.writeUInt32BE(textLength, 4);
  result.writeUInt16BE(1, 8);
  result.writeUInt16BE(TEXT_RECORD_SIZE, 10);
  result.writeUInt16BE(0, 12);
  result.write("MOBI", 16, "ascii");
  result.writeUInt32BE(KF8_HEADER_LENGTH, 20);
  result.writeUInt32BE(2, 24);
  result.writeUInt32BE(65001, 28);
  result.writeUInt32BE(0x4b463846, 32);
  result.writeUInt32BE(8, 36);
  result.writeUInt32BE(titleOffset, 84);
  result.writeUInt32BE(titleBytes.length, 88);
  result.writeUInt32BE(NO_RECORD, 124);
  result.writeUInt32BE(0, 128);
  result.writeUInt32BE(NO_RECORD, 164);
  result.writeUInt32BE(NO_RECORD, 168);
  result.writeUInt32BE(0, 172);
  result.writeUInt32BE(0, 176);
  result.writeUInt32BE(0, 180);
  result.writeUInt32BE(fdstIndex, 192);
  result.writeUInt32BE(numFdst, 196);
  result.writeUInt32BE(NO_RECORD, 200);
  result.writeUInt32BE(0, 204);
  result.writeUInt32BE(NO_RECORD, 208);
  result.writeUInt32BE(0, 212);
  result.writeUInt32BE(0, 240);
  result.writeUInt32BE(NO_RECORD, 244);
  result.writeUInt32BE(fragIndex, 248);
  result.writeUInt32BE(skelIndex, 252);
  result.writeUInt32BE(guideIndex, 260);
  titleBytes.copy(result, titleOffset);
  return result;
}

function makePdb(records: readonly Buffer[]): Buffer {
  const directory = Buffer.alloc(PDB_HEADER_SIZE + records.length * RECORD_ENTRY_SIZE);
  directory.write("自造KF8结构样本", 0, "utf8");
  directory.write("BOOK", 60, "ascii");
  directory.write("MOBI", 64, "ascii");
  directory.writeUInt16BE(records.length, 76);
  let offset = directory.length;
  records.forEach((record, index) => {
    directory.writeUInt32BE(offset, PDB_HEADER_SIZE + index * RECORD_ENTRY_SIZE);
    offset += record.length;
  });
  return Buffer.concat([directory, ...records]);
}

/**
 * 生成纯 KF8 version 8 容器，不含 MOBI7/KF8 dual 头、不含 EXTH 和 DRM。
 * `fdst: none` 对应 libmobi 允许的 numFdst=1、无 FDST 表；`stream` 对应真实两段 FDST 流。
 */
export function makeKf8Fixture(options: Kf8FixtureOptions = {}): Buffer {
  const fdstMode = options.fdst ?? "stream";
  const title = options.title ?? "自造 KF8 结构样本";
  const skeleton = Buffer.from("<html><head><title>KF8 结构</title></head><body></body></html>", "utf8");
  const insertOffset = skeleton.indexOf("</body>");
  const fragment = Buffer.from("<section id=\"chapter-one\"><h1>第一章：星河 🐉</h1><p>这是自造的中文正文。</p></section>", "utf8");
  const rawText = Buffer.concat([skeleton, fragment]);
  const skelPrimary = makeIndexPrimary([[1, 1, 1, 0], [6, 2, 2, 0], [0, 0, 0, 1]], 0);
  const skelSecondary = makeIndexEntries([{ name: "SKEL0000000000", control: 3, values: [1, 0, skeleton.length] }]);
  const fragPrimary = makeIndexPrimary([
    [2, 1, 1, 0], [3, 1, 2, 0], [4, 1, 4, 0], [6, 2, 8, 0], [0, 0, 0, 1],
  ], 1);
  const fragSecondary = makeIndexEntries([{ name: String(insertOffset), control: 15, values: [0, 0, 0, 0, fragment.length] }]);
  const cncX = makeCncx("[data-kf8-fragment=\"chapter-one\"]");
  const records: Buffer[] = [Buffer.alloc(0), rawText, skelPrimary, skelSecondary, fragPrimary, fragSecondary, cncX];
  const fdstIndex = fdstMode === "stream" ? records.length : NO_RECORD;
  if (fdstMode === "stream") records.push(makeFdst([[0, skeleton.length], [skeleton.length, rawText.length]]));
  records[0] = makeHeader(title, rawText.length, fdstIndex, fdstMode === "stream" ? 2 : 1, 4, 2, NO_RECORD);
  return makePdb(records);
}
