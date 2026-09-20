import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CBZ_MAX_IMAGE_PIXELS, validateCbzImage } from "./cbz-image";
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC";
async function image(format: "png" | "jpeg" | "gif" | "webp", width = 32, height = 24): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 136, g: 68, b: 34 } } }).toFormat(format).toBuffer();
}
async function animated(format: "gif" | "webp"): Promise<Buffer> {
  const raw = Buffer.from([255, 0, 0, 0, 255, 0]);
  return sharp(raw, { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).toFormat(format, { loop: 0, delay: [20, 20] }).toBuffer();
}

describe("CBZ真实图片解码与安全边界", () => {
  it.each(["png", "jpeg", "gif", "webp"] as const)("真实%s经sharp解码，非仅检查文件头，返回真实尺寸", async format => {
    const bytes = await image(format, 37, 29), result = await validateCbzImage(`cover.${format === "jpeg" ? "jpg" : format}`, bytes);
    expect(result).toEqual({ width: 37, height: 29, mime: `image/${format === "jpeg" ? "jpeg" : format}` });
  });
  it("合法PNG输入原始字节不被validate重编码，decode=false也校验metadata", async () => {
    const bytes = await image("png", 17, 19), before = Buffer.from(bytes), result = await validateCbzImage("p.PNG", bytes, false);
    expect(result).toMatchObject({ width: 17, height: 19, mime: "image/png" }); expect(bytes).toEqual(before);
  });
  it.each([
    ["fake.jpg", Buffer.from(pngBase64, "base64")], ["fake.png", Buffer.from("not a png")],
    ["fake.gif", Buffer.from("GIF89a" + "not pixels")], ["fake.webp", Buffer.from("RIFFxxxxWEBP")],
  ] as const)("扩展名与内容%s不一致或不可解码，不能靠header通过", async (name, bytes) => { await expect(validateCbzImage(name, bytes)).rejects.toThrow(); });
  it("SVG即使扩展名为png也不能作为栅格图片", async () => { const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"); await expect(validateCbzImage("x.png", svg)).rejects.toThrow(); });
  it("扩展名大小写允许但未知扩展和无后缀拒绝", async () => {
    const bytes = await image("png"); await expect(validateCbzImage("x", bytes)).rejects.toThrow(); await expect(validateCbzImage("x.bmp", bytes)).rejects.toThrow(); await expect(validateCbzImage("x.PnG", bytes)).resolves.toMatchObject({ mime: "image/png" });
  });
  it("decode=false只做完整metadata校验，不做raw像素解码但仍返回尺寸", async () => {
    const bytes = await image("jpeg", 10, 11), info = await validateCbzImage("x.jpg", bytes, false); expect(info).toEqual({ width: 10, height: 11, mime: "image/jpeg" });
  });
  it.each(["png", "jpeg", "gif", "webp"] as const)("截断真实%s不能因metadata读出格式而成功", async format => {
    const bytes = await image(format); await expect(validateCbzImage(`x.${format === "jpeg" ? "jpg" : format}`, bytes.subarray(0, -1))).rejects.toThrow();
  });
  it("多帧GIF/WebP明确拒绝，不能只显示第一帧", async () => { for (const format of ["gif", "webp"] as const) await expect(validateCbzImage(`x.${format}`, await animated(format))).rejects.toThrow(/动画|多帧/); });
  it("24MiB字节边界在sharp前拒绝，避免大输入传入解码器", async () => {
    const bytes = Buffer.alloc(24 * 1024 * 1024 + 1); await expect(validateCbzImage("x.png", bytes)).rejects.toThrow(/字节/);
  });
  it("16M像素恰好允许，超过1像素拒绝", async () => {
    const edge = await image("png", 4096, 4096); expect((await validateCbzImage("edge.png", edge)).width).toBe(4096);
    const tooWide = await image("png", 4097, 4096); await expect(validateCbzImage("too.png", tooWide)).rejects.toThrow(/尺寸|像素|pixel/i); expect(CBZ_MAX_IMAGE_PIXELS).toBe(16_777_216);
  }, 30000);
  it("极端维度即使像素不超限也拒绝", async () => { const bytes = await image("png", 20001, 1); await expect(validateCbzImage("wide.png", bytes)).rejects.toThrow(/尺寸/); }, 30000);
});

