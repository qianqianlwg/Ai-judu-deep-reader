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
  // WHY：资源快照不可接受同名覆盖；上游同步写仍只在可终止且限权worker内执行。
  source = once(source, 'writeFileSync(url, data);', 'writeFileSync(url, data, { flag: "wx" });');
  // WHY：封面offset=0是首个资源，不能因数值为假而丢失合法封面。
  source = once(source, '    if (offset) {\n      return this.loadResource(offset);', '    if (offset !== undefined) {\n      return this.loadResource(offset);');
  // WHY：纯外链/无recindex图片应保留为不可信HTML待统一净化，而非崩溃；绝不下载外部URL。
  source = once(source, 'const recindex = matched.match(this.recindexReg)[1];', 'const recindex = matched.match(this.recindexReg)?.[1];\n        if (!recindex) return matched;');
  // WHY：布局快照保留head中的样式/元数据而不是仅保留正文；它仍是不可信内容，不能直接执行。
  source = once(source, '    const referenceStr = firstChapterText.slice(0, bodyOpenTagIndex);', '    const referenceStr = firstChapterText.slice(0, bodyOpenTagIndex);\n    this.layoutHead = referenceStr;');
  source = once(source, '      html,\n      css: []', '      html,\n      head: this.layoutHead ?? "",\n      css: []');
  source = once(source, '      html: bodyReplaced,\n      css: cssUrls', '      html: bodyReplaced,\n      head: this.replaceResources(head),\n      css: cssUrls');
  // WHY：捕获后的预算不足以阻止解析器先写满磁盘；在每次上游写入之前按本次目录累计限额。
  source = once(source, 'function saveResource(data, type, filename, imageSaveDir) {', 'const resourceWriteBudgets = new Map();\nfunction saveResource(data, type, filename, imageSaveDir) {');
  source = once(source, '    const url = resolve(imageSaveDir, fileName);\n    writeFileSync(url, data, { flag: "wx" });', '    const url = resolve(imageSaveDir, fileName);\n    const size = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data?.byteLength;\n    const usage = resourceWriteBudgets.get(imageSaveDir) ?? { bytes: 0, files: 0 };\n    if (!Number.isSafeInteger(size) || size < 1 || size > 104857600 || usage.bytes + size > 104857600 || usage.files >= 5000) throw new Error("MOBI resource write exceeds budget");\n    writeFileSync(url, data, { flag: "wx" });\n    resourceWriteBudgets.set(imageSaveDir, { bytes: usage.bytes + size, files: usage.files + 1 });');
  // WHY：磁盘路径不是书籍资源地址；候选统一返回包内ID，不能将Windows路径注入HTML/CSS或正文。
  source = once(source, '    resourceWriteBudgets.set(imageSaveDir, { bytes: usage.bytes + size, files: usage.files + 1 });\n    return url;', '    resourceWriteBudgets.set(imageSaveDir, { bytes: usage.bytes + size, files: usage.files + 1 });\n    return "mobi-resource-v1/" + fileName;');
  // WHY：仅在属性/CSS URL语义位置改写引用，普通正文、标题、SVG文本和content字符串逐字保留。
  source = 'import { rewriteMobiResourceMarkup, rewriteMobiResourceCss, rewriteMobiLegacyMarkup } from "../../src/lib/mobi-layout-rewrite.mjs";\n' + source;
  source = once(source, 'const textReplaced = this.replaceResources(text);', 'const textReplaced = type === MIME.CSS ? rewriteMobiResourceCss(text, value => this.replaceResources(value)) : rewriteMobiResourceMarkup(text, value => this.replaceResources(value));');
  source = once(source, 'const bodyReplaced = this.replaceResources(body);', 'const bodyReplaced = rewriteMobiResourceMarkup(body, value => this.replaceResources(value));');
  source = once(source, 'head: this.replaceResources(head),', 'head: rewriteMobiResourceMarkup(head, value => this.replaceResources(value)),');
  // WHY：额外公开只读原始章节字节与片段来源，用于精确定位；不依赖猜测下一个id的resolveHref。
  source = 'import { reconstructKf8Source } from "../../src/lib/mobi-source-bytes.mjs";\n' + source;
  source = once(source, '        size: buffer.length', '        size: buffer.length,\n        sourceBytes: buffer,\n        fileStart: start + matched.length');
  const mobiClass = source.indexOf('class Mobi {');
  const methodAt = source.indexOf('  getSpine() {', mobiClass);
  if (methodAt < 0) throw new Error("MOBI source method anchor drift");
  source = source.slice(0, methodAt) + `  getSourceChapter(id) {
    const chapter = this.chapters.find(item => item.id === id);
    if (!chapter) return undefined;
    return { id, encoding: this.mobiFile.mobiHeader.encoding, bytes: chapter.sourceBytes.slice(), fileStart: chapter.fileStart };
  }
` + source.slice(methodAt);
  const loadStart = source.indexOf('  loadText(chapter) {');
  const loadEnd = source.indexOf('  loadChapter(id) {', loadStart);
  if (loadStart < 0 || loadEnd < 0) throw new Error("KF8 source method anchor drift");
  source = source.slice(0, loadStart) + `  getSourceChapter(id) {
    const chapter = this.chapters.find(item => item.id === id);
    if (!chapter) return undefined;
    const { skel, frags, length } = chapter;
    const raw = this.loadRaw(skel.offset, skel.offset + length);
    if (skel.length > raw.length) throw new Error("KF8 skeleton source exceeds raw bytes");
    const fragments = frags.map(frag => {
      const from = skel.length + frag.offset, to = from + frag.length;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < skel.length || to < from || to > raw.length) throw new Error("KF8 fragment source exceeds raw bytes");
      return { fid: frag.index, insertOffset: frag.insertOffset - skel.offset, bytes: raw.slice(from, to) };
    });
    const rebuilt = reconstructKf8Source(raw.slice(0, skel.length), fragments);
    return { id, encoding: this.mobiFile.mobiHeader.encoding, ...rebuilt };
  }
  loadText(chapter) {
    return this.mobiFile.decode(this.getSourceChapter(chapter.id).bytes.buffer);
  }
` + source.slice(loadEnd);

  // WHY：渲染与定位共享同一真实body源码窗口；不再用正则裁剪带引号或伪标签的文档。
  source = 'import { projectMobiDocument } from "../../src/lib/mobi-document-projection.mjs";\n' + source;
  source = once(source, '    const head = str.match(/<head[^>]*>([\\s\\S]*)<\\/head>/i)[1];', '    const projection = projectMobiDocument(str);\n    const head = projection.head;');
  source = once(source, '    const body = str.match(/<body[^>]*>([\\s\\S]*)<\\/body>/i)[1];', '    const body = projection.body;');
  const cropStart = source.indexOf('    const lastChapterText = chapters[chapters.length - 1].text;');
  const cropEnd = source.indexOf('    this.chapters = chapters;', cropStart);
  if (cropStart < 0 || cropEnd < cropStart) throw new Error('MOBI body projection patch anchor drift');
  source = source.slice(0, cropStart) + '    const firstChapterText = chapters[0].text;\n    const firstProjection = projectMobiDocument(firstChapterText);\n    const bodyOpenTagIndex = firstProjection.prefixEnd;\n    for (const chapter of chapters) chapter.text = chapter.id === "0" ? firstProjection.body : projectMobiDocument(chapter.text).body;\n' + source.slice(cropEnd);

  const legacyStart = source.indexOf('  replace(html) {', source.indexOf('class Mobi {'));
  const legacyEnd = source.indexOf('  resolveHref(href) {', legacyStart);
  if (legacyStart < 0 || legacyEnd < legacyStart) throw new Error('MOBI semantic legacy patch anchor drift');
  source = source.slice(0, legacyStart) + '  replace(html) {\n    return { html: rewriteMobiLegacyMarkup(html, index => this.loadResource(index)), head: this.layoutHead ?? "", css: [] };\n  }\n' + source.slice(legacyEnd);
  for (const className of ['Kf8', 'Mobi']) {
    const at = source.indexOf('  getCoverImage() {', source.indexOf('class ' + className + ' {'));
    if (at < 0) throw new Error('MOBI resource provenance patch anchor drift');
    source = source.slice(0, at) + '  getResourceAliases() {\n    return Array.from(this.resourceCache).filter(([key, value]) => key !== "cover" && typeof key === "string" && typeof value === "string");\n  }\n' + source.slice(at);
  }
  return source;
}
