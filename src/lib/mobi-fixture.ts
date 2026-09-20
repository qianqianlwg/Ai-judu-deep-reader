/** 无第三方书籍内容的最小MOBI6/PalmDOC样本。只证明对应容器，不冒充KF8样本。 */
export function makeMobiFixture(options: { exth?: boolean; text?: string; compression?: 1 | 2; title?: string; resources?: readonly Buffer[]; coverIndex?: number } = {}): Buffer {
  const raw = Buffer.from(options.text ?? "<html><body><h1>第一章</h1><p>第一段。</p><mbp:pagebreak/><p>第二段😀。</p></body></html>");
  const title = Buffer.from(options.title ?? "本地测试标题");
  const exth = options.exth !== false;
  const cover = options.coverIndex;
  if (cover !== undefined && (!exth || !Number.isSafeInteger(cover) || cover < 0 || cover >= (options.resources?.length ?? 0))) throw new Error("fixture封面索引无效");
  const titleOffset = exth ? 260 + (cover === undefined ? 0 : 12) : 248;
  const first = Buffer.alloc(titleOffset + title.length);
  first.writeUInt16BE(options.compression ?? 1, 0);
  first.writeUInt32BE(raw.length, 4);
  first.writeUInt16BE(1, 8);
  first.writeUInt16BE(4096, 10);
  first.write("MOBI", 16, "ascii");
  first.writeUInt32BE(232, 20);
  first.writeUInt32BE(2, 24);
  first.writeUInt32BE(65001, 28);
  first.writeUInt32BE(20260920, 32);
  first.writeUInt32BE(6, 36);
  first.writeUInt32BE(titleOffset, 84);
  first.writeUInt32BE(title.length, 88);
  first.writeUInt32BE(2, 108);
  first.writeUInt32BE(exth ? 64 : 0, 128);
  first.writeUInt32BE(0xffffffff, 244); // 无NCX索引
  if (exth) { first.write("EXTH", 248, "ascii"); first.writeUInt32BE(12 + (cover === undefined ? 0 : 12), 252); if (cover !== undefined) { first.writeUInt32BE(1, 256); first.writeUInt32BE(201, 260); first.writeUInt32BE(12, 264); first.writeUInt32BE(cover, 268); } }
  title.copy(first, titleOffset);
  // WHY：PalmDOC测试只使用规范的literal runs；不以同一未压缩字节改标记伪装压缩样本。
  const groups: Buffer[] = [];
  if (options.compression === 2) for (let offset = 0; offset < raw.length; offset += 8) {
    const part = raw.subarray(offset, offset + 8); groups.push(Buffer.from([part.length]), part);
  }
  const text = options.compression === 2 ? Buffer.concat(groups) : raw;
  const records = [first, text, ...(options.resources ?? [])];
  const pdb = Buffer.alloc(Math.max(96, 78 + records.length * 8));
  pdb.write("Synthetic reader fixture", 0, "ascii");
  pdb.write("BOOKMOBI", 60, "ascii");
  pdb.writeUInt16BE(records.length, 76);
  let offset = pdb.length; records.forEach((record,index)=>{pdb.writeUInt32BE(offset,78 + index * 8);offset+=record.length;});
  return Buffer.concat([pdb, ...records]);
}
