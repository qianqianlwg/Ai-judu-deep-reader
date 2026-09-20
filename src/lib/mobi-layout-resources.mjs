// @ts-check
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";

const LIMIT = 100 * 1024 * 1024, MAX_FILES = 5000;
// WHY：扩展名只提示 MIME，绝非文件类型真实性校验；字节/HTML/CSS/SVG 仍不可信，不能据此安全渲染。
const TYPES = /** @type {const} */ ({
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", bmp: "image/bmp",
  svg: "image/svg+xml", css: "text/css", xml: "application/xml", xhtml: "application/xhtml+xml", html: "text/html",
  mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", eot: "application/vnd.ms-fontobject", bin: "application/octet-stream",
});
const NAME = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|gif|bmp|svg|css|xml|xhtml|html|mp4|mkv|webm|mp3|wav|ogg|ttf|otf|woff|woff2|eot|bin)$/u;
const TEXT = new Set(["css", "svg", "xml", "xhtml", "html"]);
/** @typedef {import('node:fs').BigIntStats} Stats */
/** @typedef {{name: string, stat: Stats}} Snapshot */
/** @typedef {{id: string, mediaType: string, bytes: Uint8Array}} Resource */
/** @param {string} reason @returns {never} */
function fail(reason) { throw new Error("MOBI资源" + reason); }
/** @param {Stats} a @param {Stats} b */
function unchanged(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.birthtimeNs === b.birthtimeNs;
}
/** @param {string} directory @returns {Promise<Snapshot[]>} */
async function ancestors(directory) {
  const names = [directory];
  while (path.dirname(names[0]) !== names[0]) names.unshift(path.dirname(names[0]));
  const result = [];
  for (const name of names) {
    const stat = await lstat(name, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("目录包含链接或非目录节点");
    result.push({ name, stat });
  }
  return result;
}
/** @param {Snapshot[]} directories */
async function checkDirectories(directories) {
  for (const { name, stat } of directories) {
    const current = await lstat(name, { bigint: true });
    // WHY：共享祖先的其他子目录可能变化，仅根资源目录要求内容时间戳不变；所有层都核对身份和链接。
    if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== stat.dev || current.ino !== stat.ino
      || current.mode !== stat.mode || current.birthtimeNs !== stat.birthtimeNs || (name === directories.at(-1)?.name && !unchanged(stat, current))) fail("目录在快照期间变化");
  }
}
/** @param {Snapshot} file */
async function readBounded(file) {
  if (!unchanged(file.stat, await lstat(file.name, { bigint: true }))) fail("文件在打开前变化");
  // WHY：支持的平台使用 NOFOLLOW；Windows Node 未暴露此标志，不能声称 lstat/fstat 消除了所有目录竞争。
  const handle = await open(file.name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !unchanged(file.stat, before)) fail("打开文件身份或大小变化");
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read({ buffer: bytes, offset, length: bytes.length - offset, position: offset });
      if (!bytesRead) fail("读取提前结束");
      offset += bytesRead;
    }
    if (!unchanged(before, await handle.stat({ bigint: true }))
      || !unchanged(before, await lstat(file.name, { bigint: true }))) fail("文件在读取期间变化");
    return bytes;
  } finally { await handle.close(); }
}

/** @param {string} directory @param {Map<string, string>} ids */
function rewriter(directory, ids) {
  const prefix = directory + path.sep;
  /** @param {string} text */
  return text => {
    if (typeof text !== "string" || text.length > LIMIT || Buffer.byteLength(text, "utf8") > LIMIT) fail("文本改写预算超限或类型无效");
    /** @type {string[]} */
    const chunks = [];
    let start = 0, total = 0;
    /** @param {string} part */
    const append = part => {
      total += Buffer.byteLength(part, "utf8");
      if (total > LIMIT) fail("改写输出预算超限");
      chunks.push(part);
    };
    // WHY：只扫描原文一次，完整读取文件名再查表；不把 1.png 替换进 11.png 或 .png.bak，也不解释反斜杠。
    for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, start)) {
      let end = at + prefix.length;
      while (end < text.length && /[A-Za-z0-9_.-]/u.test(text[end])) end++;
      const id = ids.get(text.slice(at, end));
      const left = at === 0 || /[\s"'(<>=\[{},;]/u.test(text[at - 1]);
      const right = end === text.length || /[\s"')<>\]},;#?]/u.test(text[end]);
      if (!id || !left || !right) fail("引用未捕获或绝对路径边界无效");
      append(text.slice(start, at)); append(id); start = end;
    }
    append(text.slice(start));
    const result = chunks.join("");
    // 同目录自身或非原样 Windows 斜杠路径不能悄悄进入输出；不猜测 URL/转义/相对路径。
    const roots = path.sep === "\\" ? [directory, directory.replaceAll("\\", "/")] : [directory];
    for (const root of roots) {
      for (let at = result.indexOf(root); at >= 0; at = result.indexOf(root, at + root.length)) {
        const end = at + root.length;
        if (end === result.length || /[\\/\s"'()<>\[\]{},;#?]/u.test(result[end])) fail("仍含未解析的本地目录路径");
      }
    }
    return result;
  };
}

/**
 * 纯本地快照和字面路径改写；不执行、不净化、不下载，返回内容仍不可信。
 * @param {string} directory
 * @returns {Promise<{resources: Resource[], rewrite: (text: string) => string, idFor: (absolutePath: string) => string}>}
 */
export async function captureMobiResources(directory) {
  try {
    if (typeof directory !== "string" || !directory || directory.includes("\0") || !path.isAbsolute(directory)
      || directory.startsWith("\\\\") || directory.startsWith("//")
      || path.resolve(directory) !== directory || path.dirname(directory) === directory) fail("目录必须是规范化绝对路径且不能是根目录");
    const directories = await ancestors(directory);
    const names = [];
    for await (const entry of await opendir(directory)) {
      if (names.length >= MAX_FILES) fail("数量超过5000");
      if (!entry.isFile() || entry.isSymbolicLink() || NAME.exec(entry.name)?.[0] !== entry.name) fail("文件名、目录或链接无效");
      names.push(entry.name);
    }
    names.sort();
    /** @type {Snapshot[]} */
    const files = [];
    /** @type {Map<string, string>} */
    const ids = new Map();
    let sourceBytes = BigInt(0);
    // WHY：先核验所有条目的单项/累计预算，才允许 open 和分配读取缓冲区，不能靠 readFile 事后限流。
    for (const filename of names) {
      const name = path.join(directory, filename), stat = await lstat(name, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) fail("条目不是普通文件");
      if (stat.size <= BigInt(0) || stat.size > BigInt(LIMIT)) fail("单项大小必须为1至100MiB");
      sourceBytes += stat.size;
      if (sourceBytes > BigInt(LIMIT)) fail("累计大小超过100MiB");
      files.push({ name, stat }); ids.set(name, "mobi-resource-v1/" + filename);
    }
    const rewrite = rewriter(directory, ids);
    /** @type {Resource[]} */
    const resources = [];
    let outputBytes = 0;
    for (const file of files) {
      await checkDirectories(directories);
      let bytes = await readBounded(file);
      const extension = /** @type {keyof typeof TYPES} */ (path.extname(file.name).slice(1));
      if (TEXT.has(extension)) {
        let decoded;
        try { decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch (cause) { throw new Error("MOBI资源文本不是合法UTF8", { cause }); }
        const text = rewrite(decoded), size = Buffer.byteLength(text, "utf8");
        if (size === 0 || size > LIMIT || outputBytes + size > LIMIT) fail("改写后大小超限或为空");
        bytes = Buffer.from(text, "utf8");
      }
      outputBytes += bytes.length;
      if (outputBytes > LIMIT) fail("改写后累计大小超过100MiB");
      const id = ids.get(file.name);
      if (!id) fail("快照身份丢失");
      resources.push({ id, mediaType: TYPES[extension], bytes });
    }
    for (const file of files) if (!unchanged(file.stat, await lstat(file.name, { bigint: true }))) fail("文件在快照完成前变化");
    await checkDirectories(directories);
    return { resources, rewrite, idFor: absolutePath => {
      const id = ids.get(absolutePath);
      if (!id) fail("路径不在已捕获集合内");
      return id;
    } };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("MOBI资源")) throw cause;
    // WHY：对外错误不携带临时目录路径；底层错误保留在 cause 便于本地诊断，不伪装成空资源成功。
    throw new Error("MOBI资源本地快照失败", { cause });
  }
}
