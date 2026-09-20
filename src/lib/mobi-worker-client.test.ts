import { collectMobiLayoutWorker } from "./mobi-worker-client";
import { spawn, type ChildProcess } from "node:child_process";
import * as childProcesses from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectMobiWorker, readMobiWorkerResult, runMobiWorker } from "./mobi-worker-client";
import { makeMobiFixture } from "./mobi-fixture";
import * as workerClient from "./mobi-worker-client";
import { parseMobiFile } from "./mobi-parser";

// WHY：原生ESM命名空间不可重定义；只在测试模块创建可注入的副本，不更改产品装配。
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>() }));

const result = { title: "测试", authors: ["作者"], chapters: [{ id: "0", title: "第一章", paragraphs: ["正文"] }] };
const children: ChildProcess[] = [];
function processWith(script: string): ChildProcess {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced" });
  children.push(child); return child;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(children.map(async child => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      child.kill("SIGKILL");
      await closed;
    }
  }));
  children.length = 0;
  vi.unstubAllEnvs();
});

describe("独立解析进程生命周期（真实Node进程）", () => {
  it("有效消息后等到进程关闭才返回", async () => {
    const child = processWith(`process.send({ok:true,result:${JSON.stringify(result)}},()=>setTimeout(()=>process.exit(0),30))`);
    expect(await collectMobiWorker(child, { timeoutMs: 5000 })).toEqual(result); expect(child.exitCode).toBe(0);
  });
  it("同步死循环由父进程截止时间终止，不把Promise.race当CPU隔离", async () => {
    const child = processWith("while(true) {}");
    await expect(collectMobiWorker(child, { timeoutMs: 300 })).rejects.toThrow("超时");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("收到结果但不退出仍会终止，不能提前删临时目录", async () => {
    const child = processWith(`process.send({ok:true,result:${JSON.stringify(result)}},()=>{while(true){}})`);
    await expect(collectMobiWorker(child, { timeoutMs: 500 })).rejects.toThrow("超时");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("AbortSignal实际终止解析进程", async () => {
    const controller = new AbortController(), child = processWith("setInterval(()=>{},100)");
    const pending = collectMobiWorker(child, { signal: controller.signal, timeoutMs: 5000 }); controller.abort();
    await expect(pending).rejects.toThrow("取消"); expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it.each(["process.exit(0)", "process.exit(1)"])("缺失响应/非0退出均拒绝：%s", async script => {
    await expect(collectMobiWorker(processWith(script), { timeoutMs: 5000 })).rejects.toThrow("异常退出");
  });
  it("有效响应不能掩盖随后的异常退出", async () => {
    const child = processWith(`process.send({ok:true,result:${JSON.stringify(result)}},()=>process.exit(2))`);
    await expect(collectMobiWorker(child, { timeoutMs: 5000 })).rejects.toThrow("异常退出");
  });
  it("拒绝重复响应", async () => {
    const child = processWith(`const m={ok:true,result:${JSON.stringify(result)}};process.send(m,()=>process.send(m,()=>setInterval(()=>{},100)))`);
    await expect(collectMobiWorker(child, { timeoutMs: 5000 })).rejects.toThrow("重复响应");
  });
  it.each([null, { ok: true, result: { invalid: true } }, { ok: false, error: "损坏记录" }])("拒绝不可信IPC响应%j", async message => {
    const child = processWith(`process.send(${JSON.stringify(message)},()=>setInterval(()=>{},100))`);
    await expect(collectMobiWorker(child, { timeoutMs: 5000 })).rejects.toThrow(/格式无效|失败/u);
  });
});

describe("进程结果边界", () => {
  it("只取已验证字段，舍弃未知属性", () => {
    expect(readMobiWorkerResult({ ...result, privatePath: "/secret", chapters: [{ ...result.chapters[0], extra: "ignored" }] })).toEqual(result);
  });
  it.each([
    null, {}, { ...result, authors: "作者" }, { ...result, authors: [5] }, { ...result, title: 1 },
    { ...result, chapters: [] }, { ...result, chapters: [{ id: "", title: "", paragraphs: [] }] },
    { ...result, chapters: [result.chapters[0], result.chapters[0]] }, { ...result, chapters: [{ ...result.chapters[0], paragraphs: null }] },
    { ...result, authors: ["x".repeat(4097)] },
  ])("无效结果 %# 拒绝", value => { expect(() => readMobiWorkerResult(value)).toThrow(/无效/u); });
  it("限制累计输出，不能逐章绕过", () => {
    expect(() => readMobiWorkerResult({ ...result, chapters: [{ id: "0", title: "", paragraphs: ["x".repeat(10_000_001)] }, { id: "1", title: "", paragraphs: ["x".repeat(10_000_001)] }] })).toThrow("超限");
  });
  it("已取消及非法deadline在进程启动前拒绝", async () => {
    const signal = AbortSignal.abort();
    await expect(runMobiWorker({ bytes: new Uint8Array(), kind: "mobi", resourceDir: os.tmpdir() }, { signal })).rejects.toThrow("取消");
    for (const timeoutMs of [0, NaN, Infinity, 60_001, 1.5]) await expect(runMobiWorker({ bytes: new Uint8Array(), kind: "mobi", resourceDir: os.tmpdir() }, { timeoutMs })).rejects.toThrow("配置无效");
  });
});

describe("候选库真实进程与清理", () => {
  it("成功和失败后私有目录均清理且不调用上游异步unlink", async () => {
    const paths: string[] = [];
    const actual = workerClient.runMobiWorker;
    const spy = vi.spyOn(workerClient, "runMobiWorker").mockImplementation((input, options) => { paths.push(input.resourceDir); return actual(input, options); });
    try {
      await parseMobiFile(makeMobiFixture(), "test.mobi");
      await expect(parseMobiFile(makeMobiFixture({ exth: false }), "no-exth.mobi")).resolves.toMatchObject({ kind: "mobi" });
      expect(paths).toHaveLength(2);
      for (const directory of paths) await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { spy.mockRestore(); }
  }, 20000);
  it("MOBI纯文本评估不会顺带把图片写到当前目录", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-worker-test-"));
    try {
      const value = await runMobiWorker({ bytes: makeMobiFixture({ text: '<html><body><p>正文</p><img recindex="999"/></body></html>' }), kind: "mobi", resourceDir: dir });
      expect(value.chapters[0].paragraphs).toEqual(["正文"]); expect(await readdir(dir)).toEqual([]);
    } finally {
      const resolved = path.resolve(dir); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-worker-test-")) throw new Error("不安全测试清理");
      await rm(resolved, { recursive: true, force: true });
    }
  }, 20000);
});


describe("独立验收补充：异常生命周期与权限", () => {
  it("abort终止已返回IPC但仍在同步CPU循环的进程", async () => {
    const child = processWith(`process.send({ok:true,result:${JSON.stringify(result)}},()=>{while(true){}})`);
    const controller = new AbortController();
    const message = once(child, "message");
    const pending = collectMobiWorker(child, { signal: controller.signal, timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toThrow("取消");
    await message;
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    controller.abort();
    await assertion;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it.each(["spawn-throw", "spawn-error", "send-throw", "send-callback"] as const)("%s不遗漏进程或私有目录", async mode => {
    const actualSpawn = childProcesses.spawn;
    const actualRun = workerClient.runMobiWorker;
    const directories: string[] = [];
    const closed: ChildProcess[] = [];
    vi.spyOn(workerClient, "runMobiWorker").mockImplementation((input, options) => {
      directories.push(input.resourceDir);
      return actualRun(input, options);
    });
    vi.spyOn(childProcesses, "spawn").mockImplementationOnce((...args) => {
      if (mode === "spawn-throw") throw new Error("验收spawn同步失败");
      // WHY：真实ENOENT覆盖spawn异步error/close，不把手动emit当作操作系统启动失败。
      const child = mode === "spawn-error"
        ? actualSpawn(path.join(directories[0], "missing-node.exe"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] })
        : actualSpawn(...args);
      children.push(child);
      child.once("close", () => closed.push(child));
      if (mode === "send-throw") vi.spyOn(child, "send").mockImplementationOnce(() => { throw new Error("验收send同步失败"); });
      if (mode === "send-callback") vi.spyOn(child, "send").mockImplementationOnce((...sendArgs) => {
        const callback = sendArgs.find(value => typeof value === "function");
        if (typeof callback !== "function") throw new Error("缺少send回调");
        queueMicrotask(() => callback(new Error("验收send回调失败")));
        return false;
      });
      return child;
    });
    await expect(parseMobiFile(makeMobiFixture(), "failure.mobi", { timeoutMs: 2000 })).rejects.toThrow(/验收|ENOENT/u);
    expect(directories).toHaveLength(1);
    expect(closed).toHaveLength(mode === "spawn-throw" ? 0 : 1);
    for (const directory of directories) await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("不继承密钥/NODE_OPTIONS，实测正式data不可读写且不能派生进程", async () => {
    const actualSpawn = childProcesses.spawn;
    const directory = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-worker-test-"));
    const formalData = path.resolve("data");
    vi.stubEnv("OPENAI_API_KEY", "review-only-not-a-secret");
    vi.stubEnv("NODE_OPTIONS", "--conditions=review-only");
    vi.stubEnv("JUDU_DATA_DIR", formalData);
    try {
      vi.spyOn(childProcesses, "spawn").mockImplementationOnce((command, args, options) => {
        if (!Array.isArray(args) || !options) throw new Error("无效spawn装配");
        // WHY：仅替换固定入口为内存探针，保留真实权限、cwd和env；不读取或写入正式data。
        const probe = `process.once('message', () => {
          const probe = {
            env: process.env,
            readData: process.permission.has('fs.read', ${JSON.stringify(formalData)}),
            readSource: process.permission.has('fs.read', ${JSON.stringify(path.resolve('src'))}),
            readDependencies: process.permission.has('fs.read', ${JSON.stringify(path.resolve('node_modules'))}),
            writeData: process.permission.has('fs.write', ${JSON.stringify(formalData)}),
            writeOwn: process.permission.has('fs.write', process.cwd()),
            spawn: process.permission.has('child'),
            workers: process.permission.has('worker')
          };
          process.send({ok:true,result:{title:'probe',authors:[],chapters:[{id:'0',title:'',paragraphs:[JSON.stringify(probe)]}]}},()=>process.exit(0));
        });`;
        const child = actualSpawn(command, [...args.slice(0, -1), "--input-type=module", "--eval", probe], options);
        children.push(child);
        return child;
      });
      const value = await runMobiWorker({ bytes: makeMobiFixture(), kind: "mobi", resourceDir: directory });
      const probe: unknown = JSON.parse(value.chapters[0].paragraphs[0]);
      expect(probe).toMatchObject({ readData: false, readSource: false, readDependencies: false, writeData: false, writeOwn: true, spawn: false, workers: false });
      expect(value.chapters[0].paragraphs[0]).not.toMatch(/OPENAI_API_KEY|NODE_OPTIONS|JUDU_DATA_DIR/u);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-mobi-worker-test-")) throw new Error("不安全测试清理");
      await rm(resolved, { recursive: true, force: true });
    }
  });
});

/** 构造真实多记录MOBI6，不把超长单记录或改后缀伪装成合法样本。 */
function multiRecordMobi(text: string): Buffer {
  const seed = makeMobiFixture();
  const first = Buffer.from(seed.subarray(seed.readUInt32BE(78), seed.readUInt32BE(86)));
  const body = Buffer.from(text);
  const count = Math.ceil(body.length / 4096);
  first.writeUInt32BE(body.length, 4);
  first.writeUInt16BE(count, 8);
  first.writeUInt32BE(count + 1, 108);
  const directory = Buffer.alloc(78 + (count + 1) * 8 + 2);
  seed.copy(directory, 0, 0, 78);
  directory.writeUInt16BE(count + 1, 76);
  directory.writeUInt32BE(directory.length, 78);
  for (let index = 0; index < count; index++) directory.writeUInt32BE(directory.length + first.length + index * 4096, 86 + index * 8);
  return Buffer.concat([directory, first, body]);
}

describe("独立验收回归：HTML后处理不能逃离CPU隔离", () => {
  it("合法容器中的64K未闭合标签不能阻塞父事件循环", async () => {
    const bytes = multiRecordMobi(`<html><body><p>${"<".repeat(64_000)}</p></body></html>`);
    let lastBeat = performance.now();
    let maximumDelay = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maximumDelay = Math.max(maximumDelay, now - lastBeat);
      lastBeat = now;
    }, 10);
    try {
      // WHY：允许隔离解析拒绝恶意输入，但必须保持父线程可响应；样本有界，避免测试自身无限卡死。
      await parseMobiFile(bytes, "adversarial.mobi", { timeoutMs: 1000 }).catch((cause: unknown) => {
        expect(cause).toBeInstanceOf(Error);
        expect((cause as Error).message).toMatch(/超时|超限|无效/u);
      });
      maximumDelay = Math.max(maximumDelay, performance.now() - lastBeat);
      expect(maximumDelay, `父进程最长心跳间隔 ${Math.round(maximumDelay)}ms`).toBeLessThan(500);
    } finally { clearInterval(heartbeat); }
  }, 10000);
});
describe("布局IPC单独验证而不误用旧文字协议",()=>{
 const snapshot={schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,resources:[],chapters:[{id:'0',title:'章',head:'',html:'<p>文</p>',paragraphs:['文'],css:[]}],toc:[],links:[]};
 it('等正常退出后才返回严格布局结果',async()=>{const child=processWith(`process.send({ok:true,result:${JSON.stringify(snapshot)}},()=>process.exit(0))`);expect(await collectMobiLayoutWorker(child,{timeoutMs:5000})).toEqual(snapshot);expect(child.exitCode).toBe(0);});
 it('文字协议结果不能冒充布局协议',async()=>{await expect(collectMobiLayoutWorker(processWith(`process.send({ok:true,result:${JSON.stringify(result)}},()=>setInterval(()=>{},100))`),{timeoutMs:5000})).rejects.toThrow('布局快照');});
 it('已收到布局但未退出仍超时终止',async()=>{const child=processWith(`process.send({ok:true,result:${JSON.stringify(snapshot)}},()=>{while(true){}})`);await expect(collectMobiLayoutWorker(child,{timeoutMs:300})).rejects.toThrow('超时');expect(child.exitCode!==null||child.signalCode!==null).toBe(true);});
 it('取消布局进程并等待close',async()=>{const controller=new AbortController(),child=processWith('setInterval(()=>{},100)');const pending=collectMobiLayoutWorker(child,{timeoutMs:5000,signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow('取消');expect(child.exitCode!==null||child.signalCode!==null).toBe(true);});
});
