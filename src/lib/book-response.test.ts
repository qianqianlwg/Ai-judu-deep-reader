import { expect, it, vi } from 'vitest';
import { readBookPayload } from './book-response';
it('读取成功的书籍载荷', async () => {
  await expect(readBookPayload(Response.json({ id: 'book' }))).resolves.toEqual({ id: 'book' });
});
it('服务端来源错误保留明确可恢复反馈', async () => {
  await expect(readBookPayload(Response.json({ error: '无法核验原书标题来源，现有原文和标注未被覆盖。' }, { status: 409 })))
    .rejects.toThrow('无法核验原书标题来源，现有原文和标注未被覆盖。');
});
it('无有效错误字段保留HTTP状态，不接受非字符串错误', async () => {
  for (const error of [undefined, '', ' ', { message: '错误' }, 42]) {
    await expect(readBookPayload(Response.json({ error }, { status: 404 }))).rejects.toThrow('HTTP 404');
  }
});
it('非JSON错误记录解析失败并返回明确反馈', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(readBookPayload(new Response('gateway failed', { status: 502 }))).rejects.toThrow('HTTP 502');
    expect(warning).toHaveBeenCalledOnce();
  } finally { warning.mockRestore(); }
});
