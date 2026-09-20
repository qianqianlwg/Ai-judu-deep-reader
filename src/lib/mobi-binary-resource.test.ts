import { once } from "node:events";
import { createServer } from "node:http";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cbz from "./cbz-image";
import { validateMobiBinaryResource } from "./mobi-binary-resource";

type Resource = Parameters<typeof validateMobiBinaryResource>[0];
type Format = "jpeg" | "png" | "gif";
const MAX_BYTES = 24 * 1024 * 1024;
const FORMATS = ["jpeg", "png", "gif"] as const;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const PNG_END = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

async function image(format: Format, width = 23, height = 19): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#884422" } }).toFormat(format).toBuffer();
}

function resource(bytes: Uint8Array, format: Format = "png"): Resource {
  return { id: `mobi-resource-v1/cover.${format === "jpeg" ? "jpg" : format}`, mediaType: `image/${format}`, bytes };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MOBI二进制资源：仅接受真解码的静态栅格图", () => {
  it.each(FORMATS)("真实 %s 成功，返回原始字节而非重编码结果", async format => {
    const bytes = new Uint8Array(await image(format)), before = new Uint8Array(bytes);
    const result = await validateMobiBinaryResource(resource(bytes, format));
    expect(result?.mediaType).toBe(`image/${format}`);
    expect(new Uint8Array(result!.bytes)).toEqual(before);
    expect(bytes).toEqual(before);
    expect(result?.bytes).not.toBe(bytes);
  });

  it.each(["jpg", "jpeg", "JPG", "JpEg"])("JPEG 支持 .%s 扩展名", async extension => {
    const entry = { ...resource(await image("jpeg"), "jpeg"), id: `cover.${extension}` };
    await expect(validateMobiBinaryResource(entry)).resolves.toMatchObject({ mediaType: "image/jpeg" });
  });

  it("PNG/GIF 扩展名忽略大小写", async () => {
    for (const format of ["png", "gif"] as const) {
      await expect(validateMobiBinaryResource({ ...resource(await image(format), format), id: `cover.${format.toUpperCase()}` }))
        .resolves.toMatchObject({ mediaType: `image/${format}` });
    }
  });

  it("仅复制 Uint8Array 子视图，不包含其底层缓冲区的其他字节", async () => {
    const bytes = await image("png"), storage = new Uint8Array(bytes.length + 16).fill(0xab);
    storage.set(bytes, 8);
    const result = await validateMobiBinaryResource(resource(storage.subarray(8, -8)));
    expect(Buffer.from(result!.bytes)).toEqual(bytes);
  });

  it("异步校验期间修改输入字节或资源字段不影响已校验快照", async () => {
    const bytes = await image("png"), before = Buffer.from(bytes), entry = resource(bytes);
    const pending = validateMobiBinaryResource(entry);
    bytes.fill(0); entry.mediaType = "image/svg+xml"; entry.id = "evil.svg";
    expect(await pending).toEqual({ mediaType: "image/png", bytes: before });
  });

  it.each([
    ["jpeg", "png"], ["jpeg", "gif"], ["png", "jpeg"],
    ["png", "gif"], ["gif", "jpeg"], ["gif", "png"],
  ] as const)("真实 %s 不接受声明为 %s MIME", async (actual, declared) => {
    const entry = { ...resource(await image(actual), actual), mediaType: `image/${declared}` };
    await expect(validateMobiBinaryResource(entry)).rejects.toThrow(/^MOBI.*MIME.*扩展名/u);
  });

  it.each(["cover", "png", "cover.svg", "cover.bmp", "cover.jpg", "cover.png.exe", "cover.png?x", "cover.png#x", "cover.png\n"])(
    "支持 MIME 不接受缺失或错误扩展名 %s", async id => {
      await expect(validateMobiBinaryResource({ ...resource(await image("png")), id })).rejects.toThrow(/^MOBI.*扩展名/u);
    },
  );

  it.each(FORMATS)("扩展名和 MIME 同时伪装为 %s，仍按真实字节拒绝", async declared => {
    const bytes = await image(declared === "png" ? "jpeg" : "png");
    await expect(validateMobiBinaryResource(resource(bytes, declared))).rejects.toThrow(/^MOBI.*内容.*MIME/u);
  });

  it.each([
    ["png", Buffer.concat([PNG_HEADER, Buffer.from("not pixels"), PNG_END])],
    ["jpeg", Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0xff, 0xd9])],
    ["gif", Buffer.from("GIF89anot pixels;")],
  ] as const)("伪造 %s 首尾签名不能代替真解码", async (format, bytes) => {
    await expect(validateMobiBinaryResource(resource(bytes, format))).rejects.toThrow(/^MOBI图片校验失败/u);
  });

  it("SVG 即使补上 PNG 文件尾也不会进入解码器或触发网络访问", async () => {
    const decode = vi.spyOn(cbz, "validateCbzImage"), fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/a.png"/></svg>');
    await expect(validateMobiBinaryResource(resource(Buffer.concat([svg, PNG_END])))).rejects.toThrow(/^MOBI.*内容/u);
    expect(decode).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(FORMATS)("%s 真实文件删去最后一字节必须拒绝", async format => {
    const bytes = await image(format);
    await expect(validateMobiBinaryResource(resource(bytes.subarray(0, -1), format))).rejects.toThrow(/^MOBI.*截断/u);
  });

  it("PNG 保留合法元数据和尾块、但截断像素数据仍拒绝", async () => {
    const bytes = await image("png"), pieces: Buffer[] = [bytes.subarray(0, 8)];
    for (let at = 8; at < bytes.length;) {
      const length = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
      const data = bytes.subarray(at + 8, at + 8 + length);
      pieces.push(type === "IDAT" ? pngChunk(type, data.subarray(0, Math.floor(length / 2))) : bytes.subarray(at, at + length + 12));
      at += length + 12;
    }
    const truncated = Buffer.concat(pieces);
    // WHY：证明损坏不在 metadata 门槛；必须实际解码，不能仅凭文件头、尺寸和 IEND 放行。
    expect(await sharp(truncated).metadata()).toMatchObject({ format: "png", width: 23, height: 19 });
    await expect(validateMobiBinaryResource(resource(truncated))).rejects.toThrow(/^MOBI图片校验失败/u);
  });

  it("真实多帧 GIF 必须拒绝，不悄悄取第一帧", async () => {
    const bytes = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    }).gif({ loop: 0, delay: [20, 20] }).toBuffer();
    await expect(validateMobiBinaryResource(resource(bytes, "gif"))).rejects.toThrow(/^MOBI.*(?:动画|多帧)/u);
  });
});

describe("MOBI二进制资源：预算与失败契约", () => {
  it.each([0, MAX_BYTES + 1])("%s 字节在解码前拒绝", async size => {
    const decode = vi.spyOn(cbz, "validateCbzImage");
    await expect(validateMobiBinaryResource(resource(new Uint8Array(size)))).rejects.toThrow(/^MOBI.*字节.*24 MiB/u);
    expect(decode).not.toHaveBeenCalled();
  });

  it("恰好 24 MiB 的真实 PNG 可接受且字节完整保留", async () => {
    const png = await image("png");
    // WHY：加入合法私有辅助块覆盖精确字节边界，不能通过 mock 解码器冒充真实图片成功。
    const padding = pngChunk("vpAg", Buffer.alloc(MAX_BYTES - png.length - 12));
    const bytes = Buffer.concat([png.subarray(0, -12), padding, PNG_END]);
    const result = await validateMobiBinaryResource(resource(bytes));
    expect(result?.bytes.byteLength).toBe(MAX_BYTES);
    expect(Buffer.from(result!.bytes).equals(bytes)).toBe(true);
  }, 30000);

  it("恰好 16,777,216 像素可接受，超过该上限拒绝", async () => {
    expect(cbz.CBZ_MAX_IMAGE_PIXELS).toBe(16_777_216);
    const edge = await image("png", 4096, 4096);
    await expect(validateMobiBinaryResource(resource(edge))).resolves.toMatchObject({ mediaType: "image/png" });
    await expect(validateMobiBinaryResource(resource(await image("png", 4097, 4096)))).rejects.toThrow(/^MOBI.*(?:尺寸|像素)/u);
  }, 30000);

  it.each([[20001, 1], [1, 20001]])("%s × %s 虽未超像素预算也拒绝极端维度", async (width, height) => {
    await expect(validateMobiBinaryResource(resource(await image("png", width, height)))).rejects.toThrow(/^MOBI.*尺寸/u);
  });

  it("解码器异常包装为明确 MOBI 错误并保留 cause", async () => {
    const cause = new Error("decoder failure");
    vi.spyOn(cbz, "validateCbzImage").mockRejectedValueOnce(cause);
    await expect(validateMobiBinaryResource(resource(await image("png"))))
      .rejects.toMatchObject({ message: "MOBI图片校验失败：decoder failure", cause });
  });

  it("非 Error 异常也不静默吞掉或降级为 null", async () => {
    vi.spyOn(cbz, "validateCbzImage").mockRejectedValueOnce("decoder failure");
    await expect(validateMobiBinaryResource(resource(await image("png"))))
      .rejects.toMatchObject({ message: "MOBI图片校验失败：图像解码器返回未知错误", cause: "decoder failure" });
  });

  it("解码器返回不匹配 MIME 仍不能发布", async () => {
    vi.spyOn(cbz, "validateCbzImage").mockResolvedValueOnce({ width: 1, height: 1, mime: "image/jpeg" });
    await expect(validateMobiBinaryResource(resource(await image("png")))).rejects.toThrow(/^MOBI.*实际格式.*MIME/u);
  });

  it.each([null, {}, { id: 1, mediaType: "image/png", bytes: new Uint8Array() },
    { id: "a.png", mediaType: null, bytes: new Uint8Array() }, { id: "a.png", mediaType: "image/png", bytes: "file.png" }])(
    "运行时非法输入 %# 抛明确 MOBI 错误", async value => {
      await expect(validateMobiBinaryResource(value as unknown as Resource)).rejects.toThrow(/^MOBI.*字段/u);
    },
  );
});

describe("MOBI二进制资源：明确不支持，不冒充验证", () => {
  it.each([
    ["bmp", "image/bmp"], ["webp", "image/webp"], ["avif", "image/avif"],
    ["ttf", "font/ttf"], ["otf", "font/otf"], ["woff", "font/woff"], ["woff2", "font/woff2"],
    ["eot", "application/vnd.ms-fontobject"], ["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["ogg", "audio/ogg"],
    ["mp4", "video/mp4"], ["webm", "video/webm"], ["mkv", "video/x-matroska"],
    ["bin", "application/octet-stream"], ["unknown", "application/x-unknown"],
    ["css", "text/css"], ["svg", "image/svg+xml"], ["html", "text/html"], ["xml", "application/xml"],
    ["bin", "constructor"], ["bin", "toString"], ["bin", "__proto__"],
  ])("%s / %s 返回 null，不调用栅格解码器", async (extension, mediaType) => {
    const decode = vi.spyOn(cbz, "validateCbzImage");
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(validateMobiBinaryResource({ id: `mobi-resource-v1/file.${extension}`, mediaType, bytes })).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it("未知 MIME 的真实 PNG 也不嗅探后自动升级", async () => {
    const decode = vi.spyOn(cbz, "validateCbzImage");
    await expect(validateMobiBinaryResource({ ...resource(await image("png")), mediaType: "application/octet-stream" })).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
});

describe("隔离端口 API 自测（不改动主项目服务）", () => {
  it("通过真实 loopback HTTP 验证成功/损坏/不支持三条分支并释放端口", async () => {
    const valid = resource(await image("png"));
    // WHY：有界子任务尚未接入产品路由，测试内临时 API 只调用本模块，不写构建目录或动主端口。
    const server = createServer(async (request, response) => {
      try {
        const entry = request.url === "/invalid" ? resource(new Uint8Array([1, 2, 3]))
          : request.url === "/unsupported" ? { ...valid, mediaType: "image/bmp" } : valid;
        const result = await validateMobiBinaryResource(entry);
        response.writeHead(result ? 200 : 415, { "content-type": result?.mediaType ?? "text/plain" });
        response.end(result?.bytes ?? "unsupported");
      } catch (cause: unknown) {
        response.writeHead(422, { "content-type": "text/plain; charset=utf-8" });
        response.end(cause instanceof Error ? cause.message : "MOBI测试 API 未知错误");
      }
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("MOBI测试端口无效");
      const origin = `http://127.0.0.1:${address.port}`;
      const success = await fetch(origin);
      expect(success.status).toBe(200); expect(success.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await success.arrayBuffer())).toEqual(valid.bytes);
      const invalid = await fetch(`${origin}/invalid`);
      expect(invalid.status).toBe(422); expect(await invalid.text()).toMatch(/^MOBI/u);
      const unsupported = await fetch(`${origin}/unsupported`);
      expect(unsupported.status).toBe(415); expect(await unsupported.text()).toBe("unsupported");
      console.info(`MOBI binary resource API 验证端口：${address.port}，三条分支通过`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      expect(server.listening).toBe(false);
      console.info("MOBI binary resource API 临时端口已释放；主项目未重启");
    }
  });
});


it("MOBI JPEG记录短零填充保留原字节，非零/过长填充和缺失EOI仍失败",async()=>{
 const jpeg=await image("jpeg");
 for(const count of [1,2,3]){const bytes=Buffer.concat([jpeg,Buffer.alloc(count)]);expect(Buffer.from((await validateMobiBinaryResource(resource(bytes,"jpeg")))!.bytes)).toEqual(bytes);}
 for(const bytes of [Buffer.concat([jpeg,Buffer.from([1,0])]),Buffer.concat([jpeg,Buffer.alloc(4)]),Buffer.concat([jpeg.subarray(0,-2),Buffer.alloc(1)])])await expect(validateMobiBinaryResource(resource(bytes,"jpeg"))).rejects.toThrow("MOBI图片");
});
