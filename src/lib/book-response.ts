/** 保留服务端的可恢复错误说明，不用通用报错覆盖来源核验失败等原因。 */
export async function readBookPayload(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  let payload: unknown;
  try { payload = await response.json(); }
  catch (cause: unknown) { console.warn('书籍读取错误响应不是 JSON', cause); }
  if (payload && typeof payload === 'object' && 'error' in payload
    && typeof payload.error === 'string' && payload.error.trim()) {
    throw new Error(payload.error);
  }
  throw new Error(`读取书籍失败（HTTP ${response.status}），请重试`);
}
