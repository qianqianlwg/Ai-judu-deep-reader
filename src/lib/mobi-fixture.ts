/** 无第三方书籍内容的最小MOBI6/PalmDOC样本。只证明对应容器，不冒充KF8样本。 */
export function makeMobiFixture(options: { exth?: boolean; text?: string; compression?: 1 | 2; title?: string } = {}): Buffer {
  const raw = Buffer.from(options.text ?? "<html><body><h1>第一章</h1><p>第一段。</p><mbp:pagebreak/><p>第二段😀。</p></body></html>");
  const title = Buffer.from(options.title ?? "本地测试标题");
  const exth = options.exth !== false;
  const titleOffset = exth ? 260 : 248;
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
  if (exth) { first.write("EXTH", 248, "ascii"); first.writeUInt32BE(12, 252); }
  title.copy(first, titleOffset);
  // WHY：PalmDOC测试只使用规范的literal runs；不以同一未压缩字节改标记伪装压缩样本。
  const groups: Buffer[] = [];
  if (options.compression === 2) for (let offset = 0; offset < raw.length; offset += 8) {
    const part = raw.subarray(offset, offset + 8); groups.push(Buffer.from([part.length]), part);
  }
  const text = options.compression === 2 ? Buffer.concat(groups) : raw;
  const pdb = Buffer.alloc(96);
  pdb.write("Synthetic reader fixture", 0, "ascii");
  pdb.write("BOOKMOBI", 60, "ascii");
  pdb.writeUInt16BE(2, 76);
  pdb.writeUInt32BE(pdb.length, 78);
  pdb.writeUInt32BE(pdb.length + first.length, 86);
  return Buffer.concat([pdb, first, text]);
}
