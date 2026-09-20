import { createHash } from "node:crypto";
import { inflate } from "node:zlib";
import { inspectUmdContainer, decodeUmdText, UMD_LIMITS, UmdFormatError } from "./umd-container";
export type UmdCover = { bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" };
export type UmdTextChapter = { title: string; text: string; startByte: number; endByte: number };
export type UmdBook = {
  kind: "text"; title: string; author: string; sourceHash: string; sourceSize: number;
  declaredBytes: number; chapters: UmdTextChapter[]; cover?: UmdCover;
};

function inflateText(bytes: Buffer, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // WHY：native异步zlib在输出时执行预算，而非解压完成后才检查；不尝试raw回退或吞掉坏压缩流。
    inflate(bytes, { maxOutputLength: maximum, info: true }, (error, output: unknown) => {
      if (error) { reject(new UmdFormatError("正文压缩损坏或实际展开大小超限", { cause: error })); return; }
      if (!output || typeof output !== "object" || !("buffer" in output) || !Buffer.isBuffer(output.buffer)
        || !("engine" in output) || !output.engine || typeof output.engine !== "object"
        || !("bytesWritten" in output.engine) || output.engine.bytesWritten !== bytes.length) {
        reject(new UmdFormatError("压缩流未完整消费或存在尾随数据")); return;
      }
      resolve(output.buffer);
    });
  });
}

/** UMD文字型转换候选。仍需独立进程与生产持久化闭环后才允许接入导入。 */
export async function parseUmd(input: Uint8Array): Promise<UmdBook> {
  if (!(input instanceof Uint8Array) || input.byteLength > UMD_LIMITS.input) throw new UmdFormatError("输入大小或类型无效");
  // WHY：预检、解压与哈希用同一份快照，调用方在await期间修改Buffer不能改写已校验正文。
  const bytes = Buffer.from(input), container = inspectUmdContainer(bytes);
  const parts: Buffer[] = []; let length = 0;
  for (const segment of container.compressed) {
    const remaining = container.declaredBytes - length;
    if (remaining < 1) throw new UmdFormatError("实际正文超过声明长度");
    const part = await inflateText(segment, remaining);
    if (!part.length) throw new UmdFormatError("正文压缩块为空");
    length += part.length; parts.push(part);
  }
  if (length !== container.declaredBytes) throw new UmdFormatError("实际正文长度与声明不一致");
  const text = Buffer.concat(parts, length);
  const chapters = container.offsets.map((startByte, index) => {
    const endByte = container.offsets[index + 1] ?? text.length;
    // WHY：章节边界不能切开UTF16代理对；每章独立严格解码，不修正偏移或替换坏字符。
    return { title: container.titles[index], text: decodeUmdText(text.subarray(startByte, endByte)), startByte, endByte };
  });
  let cover: UmdCover | undefined;
  if (container.cover) {
    const raw = container.cover;
    const png = raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = raw.length >= 3 && raw[0] === 255 && raw[1] === 216 && raw[2] === 255;
    if (!png && !jpeg) throw new UmdFormatError("当前候选只接受PNG/JPEG封面，实际解码校验由转换器完成");
    cover = { bytes: Buffer.from(raw), mediaType: png ? "image/png" : "image/jpeg" };
  }
  return { kind: "text", title: container.title || "UMD 电子书", author: container.author || "未知作者", chapters,
    declaredBytes: length, sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceSize: bytes.length, ...(cover ? { cover } : {}) };
}
