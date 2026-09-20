export type MobiContainerKind = "mobi" | "kf8";
export type MobiExthEvidence = {
  offset: number;
  length: number;
  recordCount: number;
  /** EXTH 121 的原始 PDB 记录号；0xffffffff 表示没有次头。 */
  kf8BoundaryRecordIndex?: number;
};
export type MobiHeaderEvidence = {
  kind: MobiContainerKind;
  version: 6 | 7 | 8;
  headerRecordIndex: number;
  recordStart: number;
  recordEnd: number;
  headerLength: number;
  compression: 1 | 2 | 17480;
  encoding: 1252 | 65001;
  textLength: number;
  textRecordCount: number;
  recordSize: number;
  textStartRecordIndex: number;
  /** 正文记录区间右端，不包含该记录。 */
  textEndRecordIndex: number;
  encryption: 0;
  drm: { offset: number; count: 0 | 0xffffffff; size: 0; flags: 0 };
  exth?: MobiExthEvidence;
};
export type MobiHeaderInfo = MobiHeaderEvidence & {
  recordCount: number;
  recordOffsets: readonly number[];
  headers: readonly MobiHeaderEvidence[];
  isDual: boolean;
  /** 实际 BOUNDARY 标记记录，而非未经解释的 EXTH 121 值。 */
  boundaryRecordIndex?: number;
  boundaryPointerKind?: "header" | "marker";
};

const PDB_HEADER_SIZE = 78;
const RECORD_ENTRY_SIZE = 8;
const PALMDOC_HEADER_SIZE = 16;
const NO_RECORD = 0xffffffff;
// WHY：这些是候选入口的资源预算，不是格式理论上限；头部声明不能代替下游实际输出预算。
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_HEADER_RECORD_BYTES = 1024 * 1024;
const MAX_MOBI_HEADER_BYTES = 4096;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_RECORDS = 16_384;
const MAX_RECORD_SIZE = 4096;
const MAX_ENCODED_TEXT_RECORD_BYTES = 64 * 1024;
const MAX_EXTH_BYTES = 1024 * 1024;
const MAX_EXTH_RECORDS = 1024;

function ensureRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
    || offset > bytes.byteLength || length > bytes.byteLength - offset) {
    throw new Error(`MOBI ${label}超出边界`);
  }
}

function u16(bytes: Uint8Array, offset: number, label: string): number {
  ensureRange(bytes, offset, 2, label);
  return bytes[offset] * 256 + bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, label: string): number {
  ensureRange(bytes, offset, 4, label);
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function matches(bytes: Uint8Array, offset: number, value: string): boolean {
  ensureRange(bytes, offset, value.length, value);
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function readDirectory(input: Uint8Array): number[] {
  if (input.byteLength > MAX_FILE_BYTES) throw new Error("MOBI文件超过预检大小上限");
  ensureRange(input, 0, PDB_HEADER_SIZE, "PDB文件头");
  if (!matches(input, 60, "BOOK") || !matches(input, 64, "MOBI")) throw new Error("不是有效的 PDB BOOK/MOBI 容器");
  // WHY：只解释单一 record database；不能把 resource directory 或链式目录当成普通记录目录。
  if ((u16(input, 32, "PDB属性") & 1) !== 0 || u32(input, 72, "PDB后续目录") !== 0) {
    throw new Error("不支持 PDB resource database 或链式记录目录");
  }
  const count = u16(input, 76, "PDB记录数");
  if (count < 2) throw new Error("MOBI记录数无效");
  const entriesEnd = PDB_HEADER_SIZE + count * RECORD_ENTRY_SIZE;
  ensureRange(input, PDB_HEADER_SIZE, count * RECORD_ENTRY_SIZE, "PDB记录目录");
  const offsets: number[] = [];
  let previous = entriesEnd - 1;
  for (let index = 0; index < count; index++) {
    const offset = u32(input, PDB_HEADER_SIZE + index * RECORD_ENTRY_SIZE, "PDB记录偏移");
    if (offset <= previous || offset >= input.byteLength) throw new Error(`MOBI记录${index}偏移无效，必须严格递增且位于文件内`);
    offsets.push(offset);
    previous = offset;
  }
  return offsets;
}

function recordAt(input: Uint8Array, offsets: readonly number[], index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= offsets.length) throw new Error("MOBI记录索引超出边界");
  // WHY：所有头部读取都基于记录切片，文件里还有后续数据也不能补足截断的当前头部。
  return input.subarray(offsets[index], offsets[index + 1] ?? input.byteLength);
}

function readExth(record: Uint8Array, offset: number, recordStart: number): MobiExthEvidence {
  ensureRange(record, offset, 12, "EXTH头部");
  if (!matches(record, offset, "EXTH")) throw new Error("MOBI EXTH标识无效");
  const length = u32(record, offset + 4, "EXTH长度");
  const count = u32(record, offset + 8, "EXTH记录数");
  if (length < 12 || length > MAX_EXTH_BYTES) throw new Error("MOBI EXTH长度无效");
  ensureRange(record, offset, length, "EXTH区间");
  if (count > MAX_EXTH_RECORDS || count > Math.floor((length - 12) / 8)) throw new Error("MOBI EXTH记录数无效");
  const exth = record.subarray(offset, offset + length);
  let cursor = 12;
  let boundary: number | undefined;
  for (let index = 0; index < count; index++) {
    ensureRange(exth, cursor, 8, "EXTH条目头");
    const type = u32(exth, cursor, "EXTH条目类型");
    const entryLength = u32(exth, cursor + 4, "EXTH条目长度");
    if (entryLength < 8) throw new Error("MOBI EXTH条目长度无效");
    ensureRange(exth, cursor, entryLength, "EXTH条目");
    if ([121, 125, 201, 202].includes(type) && entryLength !== 12) throw new Error("MOBI EXTH整数条目长度无效");
    if (type === 121) {
      if (boundary !== undefined) throw new Error("MOBI EXTH 121不能重复");
      boundary = u32(exth, cursor + 8, "EXTH 121");
    }
    cursor += entryLength;
  }
  // WHY：只允许计数后的至多三字节零对齐，避免短计数隐藏另一组条目。
  if (length - cursor > 3 || exth.subarray(cursor).some(byte => byte !== 0)) throw new Error("MOBI EXTH记录数与长度不一致");
  return { offset: recordStart + offset, length, recordCount: count, kf8BoundaryRecordIndex: boundary };
}

function readHeader(input: Uint8Array, offsets: readonly number[], index: number): MobiHeaderEvidence {
  const record = recordAt(input, offsets, index);
  if (record.length > MAX_HEADER_RECORD_BYTES) throw new Error("MOBI头记录超过预检大小上限");
  ensureRange(record, 0, PALMDOC_HEADER_SIZE, "PalmDOC头部");
  const encryption = u16(record, 12, "PalmDOC加密标记");
  if (encryption !== 0) throw new Error("该 MOBI/AZW 文件受 DRM 或加密保护，应用不会绕过 DRM");
  if (!matches(record, 16, "MOBI")) throw new Error("不是有效的 MOBI 头部");
  const headerLength = u32(record, 20, "MOBI头长度");
  if (headerLength < 24 || headerLength > MAX_MOBI_HEADER_BYTES) throw new Error("MOBI头长度无效");
  ensureRange(record, 16, headerLength, "MOBI头部");
  const header = record.subarray(16, 16 + headerLength);
  const version = u32(header, 20, "MOBI版本");
  // WHY：只接受本候选实现明确支持的 6/7/8；旧短头和未来版本不套用当前字段布局。
  if (version !== 6 && version !== 7 && version !== 8) throw new Error("不支持的 MOBI/KF8版本");
  if (headerLength < (version === 8 ? 248 : 232)) throw new Error("MOBI头长度不足以容纳已知版本字段");
  const encoding = u32(header, 12, "MOBI编码");
  if (encoding !== 1252 && encoding !== 65001) throw new Error("不支持的 MOBI编码");
  const compression = u16(record, 0, "PalmDOC压缩");
  if (compression !== 1 && compression !== 2 && compression !== 17480) throw new Error("不支持的 PalmDOC压缩");
  // WHY：Calibre writer8/mobi.py 定义 record[164] 为 unknown_index，DRM 从 record[168]（MOBI +152）开始。
  const drmOffset = u32(header, 152, "DRM偏移");
  const drmCount = u32(header, 156, "DRM数量");
  const drmSize = u32(header, 160, "DRM长度");
  const drmFlags = u32(header, 164, "DRM标记");
  if ((drmOffset !== 0 && drmOffset !== NO_RECORD) || (drmCount !== 0 && drmCount !== NO_RECORD) || drmSize !== 0 || drmFlags !== 0) {
    throw new Error("MOBI头部包含 DRM 数据，应用不会绕过 DRM");
  }
  const textLength = u32(record, 4, "正文长度");
  const textRecordCount = u16(record, 8, "正文记录数");
  const recordSize = u16(record, 10, "PalmDOC recordSize");
  if (textRecordCount < 1 || textRecordCount > MAX_TEXT_RECORDS || index + textRecordCount >= offsets.length) {
    throw new Error("MOBI正文记录数无效或超出记录目录");
  }
  if (recordSize < 1 || recordSize > MAX_RECORD_SIZE) throw new Error("MOBI正文recordSize无效");
  if (textLength < 1 || textLength > MAX_TEXT_BYTES || textLength > textRecordCount * recordSize) throw new Error("MOBI正文长度无效或超过声明容量");
  const recordStart = offsets[index];
  const exth = (u32(header, 112, "EXTH标志") & 0x40) !== 0
    ? readExth(record, 16 + headerLength, recordStart) : undefined;
  if (version === 8 && exth?.kf8BoundaryRecordIndex !== undefined && exth.kf8BoundaryRecordIndex !== NO_RECORD) {
    throw new Error("KF8头部不能再声明 EXTH 121次头");
  }
  const titleOffset = u32(header, 68, "标题偏移");
  const titleLength = u32(header, 72, "标题长度");
  ensureRange(record, titleOffset, titleLength, "标题");
  if (titleLength > 0 && titleOffset < 16 + headerLength + (exth?.length ?? 0)) throw new Error("MOBI标题与头部重叠");
  return {
    kind: version === 8 ? "kf8" : "mobi", version, headerRecordIndex: index,
    recordStart, recordEnd: recordStart + record.length, headerLength, compression, encoding,
    textLength, textRecordCount, recordSize, textStartRecordIndex: index + 1,
    textEndRecordIndex: index + 1 + textRecordCount, encryption,
    drm: { offset: drmOffset, count: drmCount, size: drmSize, flags: drmFlags }, exth,
  };
}

function checkTextRecords(input: Uint8Array, offsets: readonly number[], header: MobiHeaderEvidence, end: number): void {
  if (header.textEndRecordIndex > end) throw new Error("MOBI正文记录越过格式边界");
  let storedLength = 0;
  for (let index = header.textStartRecordIndex; index < header.textEndRecordIndex; index++) {
    const size = (offsets[index + 1] ?? input.byteLength) - offsets[index];
    if (size > MAX_ENCODED_TEXT_RECORD_BYTES) throw new Error("MOBI正文存储记录超过大小上限");
    storedLength += size;
    if (storedLength > MAX_TEXT_BYTES) throw new Error("MOBI正文存储总量超过大小上限");
  }
  if (header.compression === 1 && storedLength < header.textLength) throw new Error("MOBI未压缩正文短于声明长度");
}

function isBoundary(input: Uint8Array, offsets: readonly number[], index: number): boolean {
  if (index < 0 || index >= offsets.length) return false;
  const record = recordAt(input, offsets, index);
  return record.length === 8 && matches(record, 0, "BOUNDARY");
}

/**
 * 有界容器预检，不解压、不解密、不解析正文/资源/索引。
 * 返回的长度是声明证据，不证明实际解压大小、HUFF 字典、KF8 索引或下游解析/渲染安全。
 * 调用方仍需隔离执行、超时及实际输出预算，且必须使用同一份未被修改的输入。
 */
export function inspectMobiContainer(input: Uint8Array): MobiHeaderInfo {
  const recordOffsets = readDirectory(input);
  const primary = readHeader(input, recordOffsets, 0);
  const pointer = primary.exth?.kf8BoundaryRecordIndex;
  if (pointer === undefined || pointer === NO_RECORD) {
    checkTextRecords(input, recordOffsets, primary, recordOffsets.length);
    return { ...primary, recordCount: recordOffsets.length, recordOffsets, headers: [primary], isDual: false };
  }
  if (pointer < 1 || pointer >= recordOffsets.length) throw new Error("MOBI EXTH 121次头索引无效");
  // WHY：以实际 BOUNDARY 记录确认分界，兼容指向标记和紧随其后的 KF8 头两种指针，不盲目加一。
  const pointsToMarker = isBoundary(input, recordOffsets, pointer);
  const boundaryRecordIndex = pointsToMarker ? pointer : pointer - 1;
  const headerRecordIndex = boundaryRecordIndex + 1;
  if (!isBoundary(input, recordOffsets, boundaryRecordIndex)) throw new Error("MOBI/KF8缺少有效 BOUNDARY边界");
  checkTextRecords(input, recordOffsets, primary, boundaryRecordIndex);
  const secondary = readHeader(input, recordOffsets, headerRecordIndex);
  if (secondary.kind !== "kf8") throw new Error("MOBI次头不是已知 KF8版本");
  checkTextRecords(input, recordOffsets, secondary, recordOffsets.length);
  return {
    ...secondary, recordCount: recordOffsets.length, recordOffsets, headers: [primary, secondary], isDual: true,
    boundaryRecordIndex, boundaryPointerKind: pointsToMarker ? "marker" : "header",
  };
}

export function isMobiExtension(value: string): value is ".mobi" | ".azw" | ".azw3" {
  return value === ".mobi" || value === ".azw" || value === ".azw3";
}

export function mobiSourceHref(kind: MobiContainerKind, id: string): string {
  return `mobi-v1/${kind}/${encodeURIComponent(id)}`;
}
