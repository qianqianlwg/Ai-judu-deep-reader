import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectMobiContainer, mobiSourceHref, type MobiContainerKind } from "./mobi-format";
import { runMobiWorker, type MobiWorkerOptions } from "./mobi-worker-client";

export type ParsedMobiChapter = { title: string; paragraphs: string[]; sourceHref: string };
export type ParsedMobi = { title: string; author: string; chapters: ParsedMobiChapter[]; kind: MobiContainerKind };

/** 受控 MOBI 文本提取入口；原版布局快照仍不直接暴露给浏览器。 */
export async function parseMobiFile(buffer: Buffer, fileName: string, options: MobiWorkerOptions = {}): Promise<ParsedMobi> {
  // WHY：在首个await前复制并预检同一快照，调用方随后改原Buffer不能绕过DRM/记录校验。
  if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("MOBI输入超过100 MiB上限");
  const bytes = Buffer.from(buffer);
  const header = inspectMobiContainer(bytes);
  const resourceDir = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-resources-"));
  let failure: unknown;
  try {
    const result = await runMobiWorker({ bytes, kind: header.kind, resourceDir }, options);
    const chapters: ParsedMobiChapter[] = [];
    for (const [index, chapter] of result.chapters.entries()) {
      const title = chapter.title.trim() || `未命名章节 ${index + 1}`;
      // WHY：正文恰与标题相同也不能删掉；来源内容必须保真，不以标题字符串过滤真实段落。
      if (chapter.paragraphs.length) chapters.push({ title, paragraphs: chapter.paragraphs, sourceHref: mobiSourceHref(header.kind, chapter.id) });
    }
    if (!chapters.length) throw new Error("MOBI中没有提取到可阅读正文");
    return { title: result.title.trim() || fileName.replace(/\.(?:mobi|azw3?)$/iu, "") || "未命名书籍",
      author: result.authors.map(author => author.trim()).filter(Boolean).join("、") || "未知作者", chapters, kind: header.kind };
  } catch (cause: unknown) { failure = cause; throw cause; }
  finally {
    // WHY：worker完成/失败均已等到进程close；只删除当前mkdtemp返回的已核验目录，不能让解析器决定路径。
    const resolved = path.resolve(resourceDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-resources-")) throw new Error("MOBI临时目录越界");
    try { await rm(resolved, { recursive: true, force: true }); }
    catch (cause: unknown) { throw new AggregateError(failure ? [failure, cause] : [cause], "MOBI临时资源清理失败"); }
  }
}
