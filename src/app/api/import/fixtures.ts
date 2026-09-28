// WHY：所有二进制验收资料都在内存生成，不读取或提交用户书籍，也不额外增加生产依赖。
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries: Record<string, string>): Buffer {
  const files: Buffer[] = [], directory: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(text), checksum = crc32(data);
    // WHY：JSZip 会把空目录重写成 STORE；直接构造有效的空 DEFLATE 流，才能复现桌面制书工具的 2 字节目录。
    const method = name.endsWith("/") ? 8 : 0;
    const compressed = method === 8 ? Buffer.from([0x03, 0x00]) : data;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    files.push(local, filename, compressed); directory.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, end]);
}
export function makeCompressedDirectoryZip(): Buffer {
  return zip({ mimetype: "application/epub+zip", "META-INF/": "", "chapter.xhtml": "<p>valid</p>" });
}
export const EPUB_HREF = "OPS/Text/chapter%20one.xhtml";
export function makeEpub(empty = false, compressedDirectories = false, canonicalPath = false): Buffer {
  const entries: Record<string, string> = {
    mimetype: "application/epub+zip",
    ...(compressedDirectories ? { "META-INF/": "", "OPS/": "" } : {}),
    "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OPS/book.opf": '<?xml version="1.0"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic EPUB</dc:title><dc:creator>Test Author</dc:creator><dc:identifier id="id">test</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="Text/chapter%20one.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>',
    "OPS/toc.ncx": '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Synthetic EPUB</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>First chapter</text></navLabel><content src="Text/chapter%20one.xhtml"/></navPoint></navMap></ncx>',
    [EPUB_HREF]: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>First chapter</title></head><body><h1>First chapter</h1>' + (empty ? "" : '<p>First&nbsp;paragraph <em>important</em>.</p><p>第二段， 保持原文。</p>') + '</body></html>',
  };
  if (canonicalPath) {
    // WHY：导入器历史夹具保留字面百分号寻址；浏览器兼容回归使用规范路径，不改变旧夹具契约。
    entries["OPS/Text/chapter-one.xhtml"] = entries[EPUB_HREF];
    delete entries[EPUB_HREF];
    for (const name of Object.keys(entries)) entries[name] = entries[name].replaceAll("chapter%20one.xhtml", "chapter-one.xhtml");
  }
  return zip(entries);
}
export function makePdf(): Buffer {
  const first = "BT /F1 12 Tf 40 150 Td (First page text.) Tj ET";
  const second = "BT /F1 12 Tf 40 150 Td (Second page text.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`, `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
  ];
  let content = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
