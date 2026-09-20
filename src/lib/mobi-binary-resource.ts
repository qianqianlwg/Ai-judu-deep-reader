import { validateCbzImage } from "./cbz-image";

// WHY：与 CBZ 共用单张图片预算；在复制输入和调用解码器之前拒绝超大字节。
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const EXTENSIONS = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
} as const;
type ImageMediaType = keyof typeof EXTENSIONS;

function supported(mediaType: string): mediaType is ImageMediaType {
  return Object.hasOwn(EXTENSIONS, mediaType);
}

function hasRasterSignature(bytes: Buffer, mediaType: ImageMediaType): boolean {
  switch (mediaType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
        && bytes.subarray(0, 6).every(byte => byte < 128);
  }
}

/** 只接受真解码通过的静态 JPEG/PNG/GIF；null 表示上层必须明确降级的未支持类型。 */
export async function validateMobiBinaryResource(resource: {
  id: string;
  mediaType: string;
  bytes: Uint8Array;
}): Promise<{ mediaType: string; bytes: Uint8Array } | null> {
  if (!resource || typeof resource.id !== "string" || typeof resource.mediaType !== "string"
    || !(resource.bytes instanceof Uint8Array)) {
    throw new Error("MOBI二进制资源字段无效");
  }
  const { id, mediaType, bytes: input } = resource;
  // WHY：不将未知字节升级为受支持资源；CSS/SVG 由独立净化器处理，绝不交给 sharp 渲染。
  if (!supported(mediaType)) return null;

  const extension = id.split(".").at(-1)?.toLowerCase();
  if (!id.includes(".") || !EXTENSIONS[mediaType].some(value => value === extension)) {
    throw new Error("MOBI图片 MIME 与扩展名不一致或扩展名不支持");
  }
  if (!input.byteLength || input.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("MOBI图片字节大小无效，必须为 1 至 24 MiB");
  }
  // WHY：在首个 await 前复制同一字节快照，避免调用方中途修改造成校验与发布不一致；不转码。
  const bytes = Buffer.from(input);
  // WHY：文件头只作解码前拒绝门槛，阻止 SVG 等被 sharp 自动识别并渲染；通过后仍须真解码。
  if (!hasRasterSignature(bytes, mediaType)) {
    throw new Error("MOBI图片内容与 MIME/扩展名不一致，或文件头已损坏");
  }

  try {
    // WHY：真实MOBI图像记录可带短零填充；只允许JPEG EOI后的0–3个零，非零尾/截断仍拒绝。
    // 校验裁去填充的完整图像，但返回原记录字节，不放宽CBZ文件自身的尾部规则。
    let end=bytes.length;
    if(mediaType==="image/jpeg")while(end>0&&bytes[end-1]===0&&bytes.length-end<4)end--;
    if(bytes.length-end>3)throw new Error("JPEG记录尾部零填充超限");
    const image = await validateCbzImage(id, bytes.subarray(0,end));
    if (image.mime !== mediaType) throw new Error("图片实际格式与 MIME 不一致");
    return { mediaType: image.mime, bytes };
  } catch (cause: unknown) {
    // WHY：受支持图片的损坏或超限必须失败，不能伪装成可降级的未知资源；保留原因供上层诊断。
    const reason = cause instanceof Error ? cause.message.replace(/^CBZ/u, "") : "图像解码器返回未知错误";
    throw new Error(`MOBI图片校验失败：${reason}`, { cause });
  }
}
