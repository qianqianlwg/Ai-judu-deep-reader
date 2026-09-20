import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readValidatedZipEntry, validateEpubImport } from "./epub-import-security";
import { makeEpub } from "../app/api/import/fixtures";
async function compressedFixture(text: string): Promise<Buffer> {
  const zip = new JSZip(); zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("chapter.xhtml", text, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
function forgeDeclaredSize(bytes: Buffer, size: number): void {
  for (let at=0;at<bytes.length-46;at++) if(bytes.readUInt32LE(at)===0x02014b50) {
    const length=bytes.readUInt16LE(at+28),name=bytes.subarray(at+46,at+46+length).toString();
    if(name!=="chapter.xhtml")continue;
    bytes.writeUInt32LE(size,at+24);const local=bytes.readUInt32LE(at+42);bytes.writeUInt32LE(size,local+22);return;
  }
  throw new Error("missing chapter");
}
describe("EPUB 服务端先验与有界解压",()=>{
 it("正常归档以及旧parser的字面百分号路径可继续导入",async()=>{await expect(validateEpubImport(makeEpub())).resolves.toBeUndefined();});
 it("先拒绝高压缩比，不进入旧parser",async()=>{const zip=await compressedFixture("x".repeat(3*1024*1024));expect(zip.length).toBeLessThan(6000);await expect(validateEpubImport(zip)).rejects.toThrow("压缩比");});
 it("虚报小尺寸不能绕过实际 zlib 输出上限",async()=>{const zip=await compressedFixture("x".repeat(3*1024*1024));forgeDeclaredSize(zip,32);await expect(validateEpubImport(zip)).rejects.toThrow("实际输出超过限制");});
 it("超限条目在解压前拒绝",async()=>{const zip=await compressedFixture("small");forgeDeclaredSize(zip,25*1024*1024);await expect(validateEpubImport(zip)).rejects.toThrow("超过限制");});
 it("实际大小和CRC必须匹配且受限解压接受正常 DEFLATE",async()=>{const zip=await compressedFixture("正文<p>Normal text and different words.</p>");await expect(validateEpubImport(zip)).resolves.toBeUndefined();const broken=Buffer.from(zip);broken[40]^=1;await expect(validateEpubImport(broken)).rejects.toThrow();});
 it("路径遍历归档不能交给parser",async()=>{const zip=new JSZip();zip.file('mimetype','application/epub+zip');zip.file('../escape','x',{createFolders:false});await expect(validateEpubImport(await zip.generateAsync({type:'nodebuffer'}))).rejects.toThrow('路径');});
});

it("拒绝comment内嵌归档加尾随字节造成的EOCD解析分歧",async()=>{
 const outer=makeEpub(),inner=await compressedFixture('x'.repeat(3*1024*1024));
 outer.writeUInt16LE(inner.length+1,outer.length-2);
 const combined=Buffer.concat([outer,inner,Buffer.from([0])]);
 await expect(validateEpubImport(combined)).rejects.toThrow('结束记录存在歧义');
});
it("不含嵌套EOCD的普通ZIP注释保持兼容",async()=>{
 const outer=makeEpub(),comment=Buffer.from('normal comment');outer.writeUInt16LE(comment.length,outer.length-2);
 await expect(validateEpubImport(Buffer.concat([outer,comment]))).resolves.toBeUndefined();
});

// WHY：复用访问器的false参数只能取消EPUB格式要求，不能关闭实际大小/CRC/歧义检查。
describe("FBZ访问器与默认EPUB导入规则隔离", () => {
  it("显式非EPUB访问器允许单FB2但validateEpubImport仍拒绝缺mimetype", async () => {
    const { visitValidatedZip } = await import("./epub-import-security");
    const zip = new JSZip(); zip.file("raw.FB2", "bounded XML bytes"); const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const visited: string[] = []; await visitValidatedZip(bytes, false, name => { visited.push(name); }); expect(visited).toEqual(["raw.FB2"]);
    await expect(validateEpubImport(bytes)).rejects.toThrow("mimetype");
  });
  it("错误mimetype内容即使CRC合法，默认EPUB仍拒绝", async () => {
    const { visitValidatedZip } = await import("./epub-import-security");
    const zip = new JSZip(); zip.file("mimetype", "application/not-epub", { compression: "STORE" }); zip.file("raw.FB2", "text");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await expect(visitValidatedZip(bytes, false, () => {})).resolves.toBeUndefined();
    await expect(validateEpubImport(bytes)).rejects.toThrow("mimetype 内容无效");
  });
  it("默认EPUB仍拒绝首条mimetype使用DEFLATE", async () => {
    const zip = new JSZip(); zip.file("mimetype", "application/epub+zip", { compression: "DEFLATE" }); zip.file("chapter.xhtml", "text");
    await expect(validateEpubImport(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow("mimetype 必须");
  });
  it("非EPUB路径先调用不会修改后续EPUB模式的校验行为", async () => {
    const { visitValidatedZip } = await import("./epub-import-security");
    const zip = new JSZip(); zip.file("chapter.xhtml", "text"); zip.file("mimetype", "application/epub+zip");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await expect(visitValidatedZip(bytes, false, () => {})).resolves.toBeUndefined();
    await expect(validateEpubImport(bytes)).rejects.toThrow("mimetype 必须");
    await expect(validateEpubImport(makeEpub())).resolves.toBeUndefined();
  });
});

describe("CBZ按需目标条目读取的CRC与路径边界", () => {
  it("只读取指定entry并保留原始字节，缺失和目录目标拒绝", async () => {
    const zip = new JSZip(), target = Buffer.from([0, 1, 2, 255, 254]); zip.file("page.png", target, { compression: "STORE" }); zip.file("other.bin", Buffer.from("不应读取"), { compression: "STORE" });
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    await expect(readValidatedZipEntry(bytes, "page.png")).resolves.toEqual(target);
    await expect(readValidatedZipEntry(bytes, "missing.png")).rejects.toThrow(/不存在/);
    await expect(readValidatedZipEntry(bytes, "")).rejects.toThrow(/不存在/);
  });
  it("目标entry内容被篡改时CRC拒绝，不以声明大小或路径通过", async () => {
    const zip = new JSZip(); zip.file("page.png", Buffer.from("原始页"), { compression: "STORE" }); const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const marker = Buffer.from("原始页"), at = bytes.indexOf(marker); expect(at).toBeGreaterThanOrEqual(0); bytes[at] ^= 1;
    await expect(readValidatedZipEntry(bytes, "page.png")).rejects.toThrow(/CRC|校验/);
  });
});

