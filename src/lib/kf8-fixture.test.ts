// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectMobiContainer } from "./mobi-format";
import { makeKf8Fixture, type Kf8FdstMode } from "./kf8-fixture";

const NO_RECORD = 0xffffffff;

type RecordSet = { bytes: Buffer; offsets: number[]; record: (index: number) => Buffer };
type CandidateOutcome =
  | { ok: true; title: string; spine: number; html: string }
  | { ok: false; error: string; timedOut: boolean };

function records(bytes: Buffer): RecordSet {
  const count = bytes.readUInt16BE(76);
  const offsets = Array.from({ length: count }, (_, index) => bytes.readUInt32BE(78 + index * 8));
  return { bytes, offsets, record: index => bytes.subarray(offsets[index], offsets[index + 1] ?? bytes.length) };
}

function varLen(bytes: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let cursor = offset;
  for (let count = 0; count < 4; count++) {
    const byte = bytes[cursor++];
    value = (value << 7) | (byte & 0x7f);
    if (byte & 0x80) return { value, next: cursor };
  }
  throw new Error("fixture varlen未终止");
}

function indexEntry(record: Buffer, entryIndex: number, valueCount: number): { name: string; control: number; values: number[] } {
  const idxt = record.readUInt32BE(20);
  const offset = record.readUInt16BE(idxt + 4 + entryIndex * 2);
  const nameLength = record[offset];
  const name = record.toString("ascii", offset + 1, offset + 1 + nameLength);
  let cursor = offset + 1 + nameLength;
  const control = record[cursor++];
  const values: number[] = [];
  for (let count = 0; count < valueCount; count++) {
    const result = varLen(record, cursor);
    values.push(result.value);
    cursor = result.next;
  }
  return { name, control, values };
}

async function runCandidate(bytes: Buffer, timeoutMs = 4_000): Promise<CandidateOutcome> {
  const resourceDir = await mkdtemp(path.join(os.tmpdir(), "judu-kf8-fixture-"));
  const script = `
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { initKf8File } = await import("@lingo-reader/mobi-parser");
    const parser = await initKf8File(Buffer.concat(chunks), process.env.KF8_RESOURCE_DIR);
    try {
      const metadata = parser.getMetadata();
      const spine = parser.getSpine();
      const chapter = spine[0];
      const loaded = chapter ? parser.loadChapter(chapter.id) : undefined;
      process.stdout.write(JSON.stringify({ ok: true, title: metadata.title, spine: spine.length, html: loaded?.html ?? "" }));
    } finally {
      parser.destroy();
    }
  `;
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, KF8_RESOURCE_DIR: resourceDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
  return await new Promise<CandidateOutcome>(resolve => {
    let settled = false;
    let timedOut = false;
    const finish = (outcome: CandidateOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); finish({ ok: false, error: error.message, timedOut }); });
    child.once("close", () => {
      clearTimeout(timer);
      if (timedOut) { finish({ ok: false, error: "候选解析器超时", timedOut: true }); return; }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (output) {
        try {
          const parsed = JSON.parse(output) as CandidateOutcome;
          finish(parsed);
          return;
        } catch { /* fall through to diagnostic text */ }
      }
      finish({ ok: false, error: Buffer.concat(stderr).toString("utf8") || output || "候选解析器无输出", timedOut: false });
    });
    child.stdin.end(bytes);
  }).finally(async () => {
    const resolved = path.resolve(resourceDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-kf8-fixture-")) {
      throw new Error("不安全测试清理路径");
    }
    await rm(resolved, { recursive: true, force: true });
  });
}

function assertHeader(result: ReturnType<typeof inspectMobiContainer>, mode: Kf8FdstMode, recordCount: number): void {
  expect(result).toMatchObject({ kind: "kf8", version: 8, headerRecordIndex: 0, recordCount,
    textRecordCount: 1, compression: 1, encoding: 65001, encryption: 0, isDual: false,
    exth: undefined });
  expect(result.drm).toEqual({ offset: NO_RECORD, count: 0, size: 0, flags: 0 });
  expect(result.headers).toHaveLength(1);
  const header = result.headers[0];
  expect(header.headerLength).toBe(264);
  expect(header.textLength).toBeGreaterThan(100);
  expect(header.textEndRecordIndex).toBe(2);
  if (mode === "none") expect(header.drm.offset).toBe(NO_RECORD);
}

describe("纯 KF8 version8 自造 fixture", () => {
  it("生成有真实两段 FDST 流的单章单 fragment，并通过容器预检", () => {
    const bytes = makeKf8Fixture({ fdst: "stream" });
    const set = records(bytes);
    const result = inspectMobiContainer(bytes);
    assertHeader(result, "stream", 8);
    const header = set.record(0);
    expect(header.readUInt32BE(192)).toBe(7);
    expect(header.readUInt32BE(196)).toBe(2);
    expect(header.readUInt32BE(248)).toBe(4);
    expect(header.readUInt32BE(252)).toBe(2);
    expect(header.readUInt32BE(260)).toBe(NO_RECORD);
    expect(set.record(1).toString("utf8")).toContain("第一章：星河 🐉");
    expect(set.record(2).subarray(192, 196).toString("ascii")).toBe("TAGX");
    expect(set.record(4).subarray(192, 196).toString("ascii")).toBe("TAGX");
    expect(indexEntry(set.record(3), 0, 3)).toEqual({ name: "SKEL0000000000", control: 3, values: [1, 0, 64] });
    expect(indexEntry(set.record(5), 0, 5)).toMatchObject({ control: 15, values: [0, 0, 0, 0, expect.any(Number)] });
    const fdst = set.record(7);
    expect(fdst.toString("ascii", 0, 4)).toBe("FDST");
    expect(fdst.readUInt32BE(4)).toBe(12);
    expect(fdst.readUInt32BE(8)).toBe(2);
    expect(fdst.readUInt32BE(12)).toBe(0);
    expect(fdst.readUInt32BE(16)).toBe(64);
    expect(fdst.readUInt32BE(20)).toBe(64);
    expect(fdst.readUInt32BE(24)).toBe(set.record(1).length);
  });

  it("覆盖 numFdst=1 无 FDST 表，仍是纯 KF8且无DRM", () => {
    const bytes = makeKf8Fixture({ fdst: "none" });
    const set = records(bytes);
    const result = inspectMobiContainer(bytes);
    assertHeader(result, "none", 7);
    expect(set.record(0).readUInt32BE(192)).toBe(NO_RECORD);
    expect(set.record(0).readUInt32BE(196)).toBe(1);
    expect(set.offsets.some((_, index) => set.record(index).subarray(0, 4).toString("ascii") === "FDST")).toBe(false);
    expect(set.record(1).toString("utf8")).toContain("中文正文");
  });

  it("索引结构保留 skel/frags 的真实字段语义", () => {
    const set = records(makeKf8Fixture());
    const skel = indexEntry(set.record(3), 0, 3);
    const frag = indexEntry(set.record(5), 0, 5);
    expect(skel.values[0]).toBe(1);
    expect(skel.values[1]).toBe(0);
    expect(skel.values[2]).toBeGreaterThan(0);
    expect(frag.name).toMatch(/^\d+$/);
    expect(frag.values).toEqual([0, 0, 0, 0, expect.any(Number)]);
    const cncX = set.record(6);
    const length = varLen(cncX, 0);
    expect(cncX.subarray(length.next, length.next + length.value).toString("utf8"))
      .toBe('[data-kf8-fragment="chapter-one"]');
  });
});

describe("第三方 KF8 parser 诊断（带进程超时，不冒充 fixture 验收）", () => {
  it("有 FDST 流样本应可被候选 parser 读取；失败则暴露为测试失败", async () => {
    const result = await runCandidate(makeKf8Fixture({ fdst: "stream" }));
    if (!result.ok) throw new Error(`候选 initKf8 失败：${result.error}`);
    expect(result).toMatchObject({ title: "自造 KF8 结构样本", spine: 1 });
    expect(result.html).toContain("第一章：星河 🐉");
  }, 10_000);

  it("numFdst=1无FDST表显式记录候选 parser 的已知缺陷", async () => {
    const result = await runCandidate(makeKf8Fixture({ fdst: "none" }));
    if (result.ok) throw new Error("候选 parser 意外接受无FDST表样本，需重新核对诊断预期");
    console.warn(`已知候选 initKf8 缺陷（不计作成功）：${result.error}`);
    expect(result.error).toMatch(/FDST|DataView|bounds|边界/i);
  }, 10_000);
});
