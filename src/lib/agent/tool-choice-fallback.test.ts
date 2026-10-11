import { describe, expect, it, vi } from "vitest";
import { createToolChoiceFallback } from "./tool-choice-fallback";
const limited = () => Object.assign(new Error('上游返回 400: Excel supports only auto/none tool_choice'), { status: 400 });
function fixture() {
  const abort = new AbortController(), onFallback = vi.fn();
  return { abort, onFallback, run: createToolChoiceFallback({ signal: abort.signal, onFallback }) };
}
describe("工具选择协议兼容", () => {
  it("明确400时仅重试auto，本轮后续步骤复用能力，小结仍为none", async () => {
    const { run, onFallback } = fixture();
    const invoke = vi.fn(async (choice: string) => { if (choice === 'required') throw limited(); return choice; });
    expect(await run('required', invoke)).toBe('auto');
    expect(await run('required', invoke)).toBe('auto');
    expect(await run('none', invoke)).toBe('none');
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['required', 'auto', 'auto', 'none']);
    expect(onFallback).toHaveBeenCalledOnce();
  });
  it("识别SDK嵌套上游信息和包装cause", async () => {
    const error = Object.assign(new Error('400'), { status: 400, error: { error: { message: 'Excel supports only auto/none tool_choice' } } });
    const invoke = vi.fn().mockRejectedValueOnce(new Error('wrapper', { cause: error })).mockResolvedValueOnce('ok');
    expect(await fixture().run('required', invoke)).toBe('ok');
    expect(invoke.mock.calls).toEqual([['required'], ['auto']]);
  });
  it.each([401, 403, 429, 500])("HTTP %i不伪装成能力限制", async status => {
    const error = Object.assign(limited(), { status }), { run, onFallback } = fixture();
    const invoke = vi.fn().mockRejectedValue(error);
    await expect(run('required', invoke)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledOnce(); expect(onFallback).not.toHaveBeenCalled();
  });
  it.each(['max_tokens unsupported', 'Invalid tool_choice', 'auto none tool_choice', '工具网络失败'])("其他错误原样上抛：%s", async message => {
    const error = Object.assign(new Error(message), { status: 400 }), { run, onFallback } = fixture();
    const invoke = vi.fn().mockRejectedValue(error);
    await expect(run('required', invoke)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledOnce(); expect(onFallback).not.toHaveBeenCalled();
  });
  it("auto重试失败直接上抛，且不跨模型请求缓存能力", async () => {
    const error = new Error('auto仍失败'), invoke = vi.fn().mockRejectedValueOnce(limited()).mockRejectedValueOnce(error);
    await expect(fixture().run('required', invoke)).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(2);
    const next = vi.fn(async () => 'ok'); await fixture().run('required', next);
    expect(next).toHaveBeenCalledWith('required');
  });
  it("取消后不发送重试", async () => {
    const { run, abort, onFallback } = fixture(), reason = new Error('cancel');
    const invoke = vi.fn(async () => { abort.abort(reason); throw limited(); });
    await expect(run('required', invoke)).rejects.toBe(reason);
    expect(invoke).toHaveBeenCalledOnce(); expect(onFallback).not.toHaveBeenCalled();
  });
  it("auto或none请求不重复降级", async () => {
    for (const choice of ['auto', 'none'] as const) {
      const error = limited(), invoke = vi.fn().mockRejectedValue(error);
      await expect(fixture().run(choice, invoke)).rejects.toBe(error);
      expect(invoke).toHaveBeenCalledOnce();
    }
  });
});
