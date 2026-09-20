// @ts-check
/** @param {string} source @param {string} before @param {string} after */
function once(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("固定MOBI补丁锚点不唯一或已漂移：" + before.slice(0, 90));
  return source.replace(before, after);
}

/**
 * 基于固定npm分发源码的可审计修复，不改node_modules、不改书籍字节。
 * WHY：合法单流KF8允许没有FDST；这是真实格式缺陷修复，不是为浏览器/工具环境绕过安全边界。
 * @param {string} input
 */
export function applyMobiPatches(input) {
  let source = once(input,
    'this.exth = mobi.exthFlag & 64 ? getExth(firstRecord.slice(mobi.length + 16), mobi.encoding) : void 0;',
    'this.exth = mobi.exthFlag & 64 ? getExth(firstRecord.slice(mobi.length + 16), mobi.encoding) : {};');
  source = once(source, '  numTextRecords: [8, 2, "uint"],', '  textLength: [4, 4, "uint"],\n  numTextRecords: [8, 2, "uint"],');
  const start = source.indexOf('    const fdstBuffer = this.mobiFile.loadRecord(kf8Header.fdst);');
  const end = source.indexOf('    const skelData = getIndexData(kf8Header.skel, loadRecord);', start);
  if (start < 0 || end < start) throw new Error("固定KF8 FDST补丁锚点漂移");
  source = source.slice(0, start) + `    // WHY：numFdst=1是合法单流，fdst槽位可能是旧兼容字段，不能当记录索引读取。
    const textLength = this.mobiFile.palmdocHeader.textLength;
    if (!Number.isSafeInteger(textLength) || textLength <= 0 || textLength > 20000000) throw new Error("KF8 text length exceeds budget");
    let fdstTable;
    if (kf8Header.numFdst === 1) {
      fdstTable = [[0, textLength]];
    } else {
      if (!Number.isSafeInteger(kf8Header.numFdst) || kf8Header.numFdst < 2 || kf8Header.numFdst > 10000) throw new Error("Invalid KF8 flow count");
      const fdstBuffer = this.mobiFile.loadRecord(kf8Header.fdst);
      if (fdstBuffer.byteLength < 12) throw new Error("Missing FDST record");
      const fdst = getStruct(fdstHeader, fdstBuffer);
      if (fdst.magic !== "FDST" || fdst.numEntries !== kf8Header.numFdst || 12 + fdst.numEntries * 8 > fdstBuffer.byteLength) throw new Error("Invalid FDST table");
      fdstTable = [];
      let lastEnd = 0;
      for (let i = 0; i < fdst.numEntries; i++) {
        const offset = 12 + i * 8;
        const from = getUint(fdstBuffer.slice(offset, offset + 4));
        const to = getUint(fdstBuffer.slice(offset + 4, offset + 8));
        if (from !== lastEnd || to < from || to > textLength) throw new Error("Invalid FDST bounds");
        fdstTable.push([from, to]); lastEnd = to;
      }
      if (lastEnd !== textLength) throw new Error("Incomplete FDST text coverage");
    }
    this.fdstTable = fdstTable;
    this.fullRawLength = textLength;
` + source.slice(end);
  // WHY：缺失记录返回空buffer不能让loadRaw的while无限循环；总量和索引双重有界。
  source = once(source, '        const data = this.mobiFile.loadTextBuffer(index);\n        this.rawHead =', '        if (index >= this.mobiFile.palmdocHeader.numTextRecords) throw new Error("KF8 raw head outside text records");\n        const data = this.mobiFile.loadTextBuffer(index);\n        if (!data.length || this.rawHead.length + data.length > 20000000) throw new Error("KF8 raw head exceeds budget");\n        this.rawHead =');
  source = once(source, '      const data = this.mobiFile.loadTextBuffer(index);\n      this.rawTail =', '      if (index < 0) throw new Error("KF8 raw tail outside text records");\n      const data = this.mobiFile.loadTextBuffer(index);\n      if (!data.length || this.rawTail.length + data.length > 20000000) throw new Error("KF8 raw tail exceeds budget");\n      this.rawTail =');
  source = once(source, '  loadRaw(start, end) {', '  loadRaw(start, end) {\n    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.fullRawLength) throw new Error("KF8 raw range outside text");');
  // WHY：原版locator属于字节区间，最后一章也必须具有真实end，不能用undefined或只找第一个更大的end。
  source = once(source, '      const end = matches[i + 1]?.index;', '      const end = matches[i + 1]?.index ?? str.length;');
  source = once(source, 'const chapter = this.chapters.find((ch) => ch.end > fileposNum);', 'const chapter = this.chapters.find((ch) => ch.start <= fileposNum && fileposNum < ch.end);');
  // WHY：合法HTML可有body属性/大写标签；缺失结束标签不能slice(0,-1)吞掉最后一个字符。
  source = once(source, 'chapters[chapters.length - 1].text = lastChapterText.slice(0, lastChapterText.indexOf("</body>"));', 'const bodyEnd = lastChapterText.search(/<\\/body\\s*>/i);\n    chapters[chapters.length - 1].text = bodyEnd < 0 ? lastChapterText : lastChapterText.slice(0, bodyEnd);');
  source = once(source, 'const bodyOpenTagIndex = firstChapterText.indexOf("<body>");\n    chapters[0].text = firstChapterText.slice(bodyOpenTagIndex + "<body>".length);', 'const bodyOpen = /<body\\b[^>]*>/i.exec(firstChapterText);\n    const bodyOpenTagIndex = bodyOpen?.index ?? 0;\n    chapters[0].text = bodyOpen ? firstChapterText.slice(bodyOpen.index + bodyOpen[0].length) : firstChapterText;');
  return source;
}
