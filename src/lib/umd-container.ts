/** UMD 字段参考与候选范围见 docs/third-party-umd.md；不把宽松解析器的容错视为规范。 */
export const UMD_LIMITS = Object.freeze({ input: 100 * 1024 * 1024, text: 20 * 1024 * 1024,
  cover: 24 * 1024 * 1024, chunks: 4096, sections: 20000, chapters: 10000 });
export type UmdContainer = { profile: "indexed-terminal" | "simple-eof"; title: string; author: string; declaredBytes: number; offsets: number[];
  titles: string[]; compressed: Buffer[]; cover?: Buffer };
export class UmdFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) { super("UMD：" + message, options); this.name = "UmdFormatError"; }
}
function fail(message: string): never { throw new UmdFormatError(message); }
export function decodeUmdText(bytes: Uint8Array): string {
  if (bytes.byteLength % 2) fail("UTF-16LE字节数必须为偶数");
  // WHY：拒绝孤立代理对，不用替换字符掩盖损坏；章节开头的BOM也保留为真实字符。
  try { return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (cause: unknown) { throw new UmdFormatError("UTF-16LE文本损坏", { cause }); }
}
function integers(bytes: Buffer): number[] {
  if (!bytes.length || bytes.length % 4) fail("索引表长度无效");
  return Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
}
function chapterTitles(bytes: Buffer): string[] {
  const titles: string[] = []; let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (!length || length % 2 || offset + length > bytes.length) fail("章节标题越界或编码长度无效");
    titles.push(decodeUmdText(bytes.subarray(offset, offset + length))); offset += length;
    if (titles.length > UMD_LIMITS.chapters) fail("章节数量超限");
  }
  if (!titles.length) fail("章节标题表为空");
  return titles;
}

/** 只预检文字型候选，不解压，不猜补缺失字段，不解读未知保护字段。 */
export function inspectUmdContainer(bytes: Buffer): UmdContainer {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > UMD_LIMITS.input || bytes.readUInt32LE(0) !== 0xde9a9b89) fail("文件标识或大小无效");
  let at = 4, sections = 0, active = 0, ended = false, nonzeroFlags = false, lastDataIsText = false;
  let declaredBytes = 0, title = "", author = "", offsets: number[] | undefined, titles: string[] | undefined;
  let chunkIds: number[] | undefined, cover: Buffer | undefined;
  const seen = new Set<number>(), checks = new Map<number, number>(), dataIds = new Set<number>();
  const chunks = new Map<number, Buffer>();
  const exact = (payload: Buffer, size: number) => { if (payload.length !== size) fail("字段长度无效"); };
  while (at < bytes.length) {
    if (++sections > UMD_LIMITS.sections) fail("块数量超限");
    if (ended || at + 5 > bytes.length || bytes[at] !== 0x23) fail("块头损坏或存在尾随数据");
    const type = bytes.readUInt16LE(at + 1), flags = bytes[at + 3], length = bytes[at + 4];
    if (length < 5 || at + length > bytes.length) fail("块长度越界");
    const payload = bytes.subarray(at + 5, at + length); at += length; lastDataIsText = false;
    nonzeroFlags ||= flags !== 0;
    // WHY：已核对writer在索引/终止块使用0或1，不能一刀切为0，也不能忽略未知位。
    if (flags !== 0 && !(flags === 1 && [0x81, 0x83, 0x84, 0x0c].includes(type))) fail("块标志尚未验收，不能忽略");
    if (type === 0xf0 || type === 0xf1) fail("保护/授权相关字段尚未验收，不会自动忽略或解密");
    if (type !== 0x0a && seen.has(type)) fail("重复字段");
    if (!seen.size && type !== 1) fail("缺少起始版本字段");
    seen.add(type);
    if (type !== 0x0a) active = type;
    if (type === 1) {
      exact(payload, 3);
      if (payload[0] !== 1) fail("当前候选仅支持文字型；漫画型和混合型需单独验收");
    } else if (type >= 2 && type <= 9) {
      const value = decodeUmdText(payload);
      if (type === 2) title = value;
      if (type === 3) author = value;
    } else if (type === 0x0a) {
      exact(payload, 4);
      if (![0x81, 0x84].includes(active)) fail("内容续块缺少有效上下文");
    } else if (type === 0x0b) {
      exact(payload, 4); declaredBytes = payload.readUInt32LE(0);
      if (!declaredBytes || declaredBytes % 2 || declaredBytes > UMD_LIMITS.text) fail("声明正文大小无效或超限");
    } else if ([0x81, 0x83, 0x84].includes(type)) {
      exact(payload, 4); const check = payload.readUInt32LE(0);
      if ([...checks.values()].includes(check)) fail("索引校验ID重复");
      checks.set(type, check);
    } else if (type === 0x82) {
      exact(payload, 5);
      if (payload[0] !== 1) fail("封面标志尚未验收");
      const check = payload.readUInt32LE(1);
      if ([...checks.values()].includes(check)) fail("封面校验ID重复");
      checks.set(type, check);
    } else if (type === 0x0c) {
      exact(payload, 4);
      if (payload.readUInt32LE(0) !== bytes.length || at !== bytes.length) fail("终止记录文件大小不一致");
      ended = true;
    } else { fail("尚未验收的块类型：0x" + type.toString(16)); }
    while (at < bytes.length && bytes[at] === 0x24) {
      if (++sections > UMD_LIMITS.sections || at + 9 > bytes.length) fail("数据块数量超限或块头截断");
      const id = bytes.readUInt32LE(at + 1), size = bytes.readUInt32LE(at + 5);
      if (size < 9 || size > bytes.length - at) fail("数据块长度越界");
      if (dataIds.has(id)) fail("数据块ID重复");
      dataIds.add(id);
      const data = bytes.subarray(at + 9, at + size); at += size; lastDataIsText = false;
      if (id === checks.get(active)) {
        if (active === 0x81) {
          if (data.length > UMD_LIMITS.chunks * 4 || chunkIds) fail("正文索引数量超限或重复");
          chunkIds = integers(data);
          if (new Set(chunkIds).size !== chunkIds.length) fail("正文索引ID重复");
        } else if (active === 0x83) {
          if (data.length > UMD_LIMITS.chapters * 4 || offsets) fail("章节索引数量超限或重复");
          offsets = integers(data);
        } else if (active === 0x84) {
          if (data.length > UMD_LIMITS.chapters * 255 || titles) fail("章节标题表超限或重复");
          titles = chapterTitles(data);
        } else if (active === 0x82) {
          if (!data.length || data.length > UMD_LIMITS.cover || cover) fail("封面大小超限或重复");
          cover = data;
        } else fail("数据块上下文无效");
      } else if (active === 0x81 || active === 0x84) {
        if (!data.length || chunks.size >= UMD_LIMITS.chunks) fail("正文压缩块为空或超限");
        chunks.set(id, data); lastDataIsText = true;
      } else { fail("数据块校验ID与上下文不符"); }
    }
  }
  const indexed = seen.has(0x81);
  if (indexed && !ended) fail("缺少完整终止记录");
  // WHY：上游实物证明无81/0c的简化文本布局存在；独立识别该profile，不能让损坏的indexed文件降级。
  if (!indexed && (ended || nonzeroFlags || !lastDataIsText || [...seen].some(type => ![1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0b, 0x83, 0x84].includes(type)))) fail("未验收的简化UMD布局或缺少正文末块");
  if (!declaredBytes || (indexed && !chunkIds) || !offsets || !titles || !chunks.size) fail("缺少正文、章节或压缩索引");
  if (seen.has(0x82) && !cover) fail("封面记录缺少实际资源");
  if (offsets.length !== titles.length || offsets[0] !== 0) fail("章节数量或起始偏移不符");
  for (const [index, offset] of offsets.entries()) {
    if (offset % 2 || offset >= declaredBytes || (index > 0 && offset <= offsets[index - 1])) fail("章节偏移越界、重复或未对齐");
  }
  if (chunkIds && (chunkIds.length !== chunks.size || chunkIds.some(id => !chunks.has(id) || [...checks.values()].includes(id)))) fail("正文索引与实际数据块不一致");
  if ([...chunks.keys()].some(id => [...checks.values()].includes(id))) fail("正文ID与元数据索引冲突");
  // WHY：0x81是成员校验表，已核实writer可逆序写表；正文必须保留数据块的物理顺序。
  return { profile: indexed ? "indexed-terminal" : "simple-eof", title, author, declaredBytes, offsets, titles, compressed: [...chunks.values()], ...(cover ? { cover } : {}) };
}
