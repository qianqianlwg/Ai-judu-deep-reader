import { spawn, type ChildProcess } from "node:child_process";
import * as processModule from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectUmdWorker, readUmdWorkerResult, runUmdWorker } from "./umd-worker-client";
import { makeUmdFixture } from "./umd-fixture";
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>() }));
const identity = { sourceHash: "a".repeat(64), sourceSize: 100 };
const result = { ...identity, kind: "text", title: "标题", author: "作者", declaredBytes: 4, chapters: [{ title: "章节", text: "正文", startByte: 0, endByte: 4 }] };
const children: ChildProcess[] = [];
function probe(script: string): ChildProcess { const child = spawn(process.execPath, ["--eval", script], { windowsHide: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] }); children.push(child); return child; }
afterEach(() => { for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("UMD进程输出边界", () => {
  it("舍弃未知字段且校验输入原件身份", () => {
    expect(readUmdWorkerResult({ ...result, ignored: "不可透传" }, identity)).toEqual(result);
    expect(() => readUmdWorkerResult(result, { ...identity, sourceHash: "b".repeat(64) })).toThrow("无效");
  });
  it.each([null, {}, { ...result, declaredBytes: 3 }, { ...result, sourceSize: 99 }, { ...result, chapters: [] },
    { ...result, kind: "mixed" }, { ...result, chapters: [{ ...result.chapters[0], startByte: 2 }] },
    { ...result, chapters: [{ ...result.chapters[0], text: "少" }] }, { ...result, cover: { bytes: new Uint8Array(3), mediaType: "image/svg+xml" } }])("无效IPC结果拒绝 %#", value => expect(() => readUmdWorkerResult(value, identity)).toThrow());
  it("取消和非法deadline在启动进程前拒绝", async () => {
    const controller = new AbortController(); controller.abort(); await expect(runUmdWorker(makeUmdFixture(), { signal: controller.signal })).rejects.toThrow("取消");
    for (const timeoutMs of [0, -1, NaN, Infinity, 60001]) await expect(runUmdWorker(makeUmdFixture(), { timeoutMs })).rejects.toThrow("配置");
  });
});
describe("UMD真实进程生命周期", () => {
  it("收到结果后必须等close再成功", async () => {
    const child = probe(`process.send({ok:true,result:${JSON.stringify(result)}});setTimeout(()=>process.exit(0),120);`);
    expect(await collectUmdWorker(child, identity, { timeoutMs: 4000 })).toEqual(result); expect(child.exitCode).toBe(0);
  });
  it("同步死循环超时后真实终止进程", async () => {
    const child = probe("while(true){}"); await expect(collectUmdWorker(child, identity, { timeoutMs: 250 })).rejects.toThrow("超时");
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("取消不能留下继续运行的进程", async () => {
    const controller = new AbortController(), child = probe("setInterval(()=>{},1000)");
    const assertion = expect(collectUmdWorker(child, identity, { signal: controller.signal })).rejects.toThrow("取消"); controller.abort(); await assertion;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it.each(["process.exit(0)", "process.exit(1)", `process.send({ok:true,result:${JSON.stringify(result)}});setTimeout(()=>process.exit(1),10)`])("异常/无响应不作为成功 %s", async script => {
    await expect(collectUmdWorker(probe(script), identity, { timeoutMs: 4000 })).rejects.toThrow("异常退出");
  });
  it("重复响应与无效响应不能盖过失败", async () => {
    const message = JSON.stringify({ ok: true, result });
    await expect(collectUmdWorker(probe(`process.send(${message});process.send(${message});setInterval(()=>{},1000)`), identity)).rejects.toThrow("重复");
    await expect(collectUmdWorker(probe("process.send({ok:true,result:null});setInterval(()=>{},1000)"), identity)).rejects.toThrow("无效");
  });
  it.each(["spawn", "send"])("%s装配异常明确抛出", async mode => {
    const actual = processModule.spawn;
    vi.spyOn(processModule, "spawn").mockImplementationOnce((command, args, options) => {
      if (mode === "spawn") throw new Error("测试启动失败");
      const child = actual(command, args, options); children.push(child); child.send = (() => { throw new Error("测试通信失败"); }) as typeof child.send; return child;
    });
    await expect(runUmdWorker(makeUmdFixture())).rejects.toThrow(/测试.*失败/u);
    for (const child of children) expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
  it("只读单个bundle且无写权限，不继承密钥或node配置", async () => {
    const bytes = makeUmdFixture(), hash = createHash("sha256").update(bytes).digest("hex"), actual = processModule.spawn;
    vi.stubEnv("OPENAI_API_KEY", "not-a-real-secret"); vi.stubEnv("NODE_OPTIONS", "--conditions=not-inherited");
    vi.spyOn(processModule, "spawn").mockImplementationOnce((command, args, options) => {
      if (!Array.isArray(args) || !options) throw new Error("装配无效");
      const script = `process.once('message',()=>{const text=JSON.stringify({source:process.permission.has('fs.read',${JSON.stringify(path.resolve("src"))}),data:process.permission.has('fs.read',${JSON.stringify(path.resolve("data"))}),write:process.permission.has('fs.write'),spawn:process.permission.has('child'),env:process.env});process.send({ok:true,result:{kind:'text',title:'探针',author:'测试',sourceHash:'${hash}',sourceSize:${bytes.length},declaredBytes:text.length*2,chapters:[{title:'权限',text,startByte:0,endByte:text.length*2}]}},()=>process.exit(0));});`;
      const child = actual(command, [...args.slice(0, -1), "--eval", script], options); children.push(child); return child;
    });
    const value = await runUmdWorker(bytes), permission: unknown = JSON.parse(value.chapters[0].text);
    expect(permission).toMatchObject({ source: false, data: false, write: false, spawn: false });
    expect(value.chapters[0].text).not.toMatch(/OPENAI_API_KEY|NODE_OPTIONS/u);
  });
});
