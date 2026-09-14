import type { ChatEvent, HistoricalToolActivity, ToolActivity } from "../chat-stream";
import { conversationToolFromRow } from "../conversations";

export type ToolHistoryDatabase = {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
};
export type ToolMessageScope = { threadId: string; messageId: string; editionId: string };
export type ToolAttemptScope = ToolMessageScope & { attemptId: string };
export type ToolAuditRun = { id: string; name: string; input: unknown; output: unknown; status: "completed" | "error" };
export type MessageToolHistory = { tools: ToolActivity[]; historicalTools: HistoricalToolActivity[] };
export class ToolAttemptNotActiveError extends Error {
  readonly code = "stale_tool_attempt";
  constructor() { super("原工具请求已结束或被重试替换，拒绝迟到写入"); this.name = "ToolAttemptNotActiveError"; }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const attempt = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const CURRENT_ATTEMPT = "CASE WHEN json_valid(m.structured_output) THEN json_extract(m.structured_output, '$._request.attemptId') END";
const ACTIVE_MESSAGE = "FROM chat_messages m JOIN reading_threads t ON t.id = m.thread_id WHERE m.id = ? AND m.thread_id = ? AND t.edition_id = ? AND m.role = 'assistant' AND m.status = 'streaming' AND " + CURRENT_ATTEMPT + " = ?";
const AUDIT_ID_PREFIX = "attempt-tool-v1:";
function validateScope(scope: ToolAttemptScope) {
  for (const value of [scope.threadId, scope.messageId, scope.editionId, scope.attemptId]) {
    if (typeof value !== "string" || !value.trim()) throw new Error("工具审计必须绑定完整的消息、版本和尝试 ID");
  }
}
function scopeArgs(scope: ToolAttemptScope) { return [scope.messageId, scope.threadId, scope.editionId, scope.attemptId]; }
export function assertCurrentToolAttempt(db: ToolHistoryDatabase, scope: ToolAttemptScope, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  validateScope(scope);
  if (!db.prepare("SELECT m.id " + ACTIVE_MESSAGE).get(...scopeArgs(scope))) throw new ToolAttemptNotActiveError();
}
export function insertCurrentAttemptToolRun(db: ToolHistoryDatabase, scope: ToolAttemptScope, run: ToolAuditRun, signal?: AbortSignal): boolean {
  signal?.throwIfAborted();
  validateScope(scope);
  if (!run.id?.trim() || !run.name?.trim() || (run.status !== "completed" && run.status !== "error")) throw new Error("工具审计字段不完整");
  // WHY：模型可在不同消息/重试中复用 tool_call_id；数据库键必须同时绑定消息与 attempt，回放再恢复原工具 ID。
  const id = AUDIT_ID_PREFIX + JSON.stringify([scope.messageId, scope.attemptId, run.id]);
  const input = JSON.stringify(run.input ?? null), output = JSON.stringify(run.output ?? null);
  signal?.throwIfAborted();
  // WHY：同步单条 INSERT…SELECT 把状态/版本/attempt 校验和写入变为原子操作；不能先读状态再 await 写入。
  const inserted = db.prepare("INSERT INTO agent_tool_runs (id,message_id,thread_id,attempt_id,tool_name,input_json,output_json,status,created_at) SELECT ?,m.id,m.thread_id,?,?,?,?,?,? " + ACTIVE_MESSAGE + " ON CONFLICT(id) DO NOTHING RETURNING id")
    .get(id, scope.attemptId, run.name, input, output, run.status, new Date().toISOString(), ...scopeArgs(scope));
  if (inserted) return true;
  assertCurrentToolAttempt(db, scope, signal);
  const existing = db.prepare("SELECT thread_id, message_id, attempt_id, tool_name, input_json, output_json, status FROM agent_tool_runs WHERE id = ?").get(id);
  if (!record(existing) || existing.thread_id !== scope.threadId || existing.message_id !== scope.messageId || existing.attempt_id !== scope.attemptId || existing.tool_name !== run.name || existing.input_json !== input || existing.output_json !== output || existing.status !== run.status) throw new Error("同一次工具调用的审计内容冲突，原记录已保留");
  return false;
}
function restoredToolId(row: Record<string, unknown>): string {
  const id = String(row.id);
  if (!id.startsWith(AUDIT_ID_PREFIX)) return id;
  try {
    const value: unknown = JSON.parse(id.slice(AUDIT_ID_PREFIX.length));
    if (Array.isArray(value) && value.length === 3 && value[0] === row.messageId && value[1] === row.attemptId && typeof value[2] === "string" && value[2].trim()) return value[2];
  } catch (error: unknown) { console.warn("恢复工具调用标识失败", { reason: error instanceof Error ? error.name : "unknown" }); }
  return id;
}
function readHistory(db: ToolHistoryDatabase, scope: { threadId: string; editionId: string; messageId?: string }, currentOnly = false): Map<string, MessageToolHistory> {
  // WHY：只读白名单输出，SQL 不取 input_json；旧 NULL 归属永不推定为当前尝试，也不删除旧审计。
  const sql = "SELECT r.id, r.message_id AS messageId, r.attempt_id AS attemptId, " + CURRENT_ATTEMPT + " AS currentAttemptId, r.tool_name AS name, CASE WHEN length(r.output_json) <= 120000 THEN r.output_json ELSE NULL END AS outputJson, r.status FROM agent_tool_runs r JOIN chat_messages m ON m.id = r.message_id AND m.thread_id = r.thread_id JOIN reading_threads t ON t.id = r.thread_id WHERE t.id = ? AND t.edition_id = ? AND m.role = 'assistant'" + (scope.messageId === undefined ? "" : " AND m.id = ?") + (currentOnly ? " AND r.attempt_id IS NOT NULL AND r.attempt_id = " + CURRENT_ATTEMPT : "") + " ORDER BY r.created_at, r.rowid";
  const args = scope.messageId === undefined ? [scope.threadId, scope.editionId] : [scope.threadId, scope.editionId, scope.messageId];
  const grouped = new Map<string, MessageToolHistory>();
  for (const row of db.prepare(sql).all(...args)) {
    if (!record(row)) throw new Error("工具历史数据格式错误");
    const saved = conversationToolFromRow(row, scope.editionId);
    if (!saved) continue;
    const group = grouped.get(saved.messageId) ?? { tools: [], historicalTools: [] };
    const tool = { ...saved.tool, id: restoredToolId(row) };
    const attemptId = attempt(row.attemptId);
    if (attemptId !== null && attemptId === attempt(row.currentAttemptId)) group.tools.push(tool);
    else group.historicalTools.push({ ...tool, attemptId, auditId: String(row.id) });
    grouped.set(saved.messageId, group);
  }
  return grouped;
}
export function readThreadToolHistory(db: ToolHistoryDatabase, scope: { threadId: string; editionId: string }): Map<string, MessageToolHistory> {
  return readHistory(db, scope);
}
export function readCurrentAttemptTools(db: ToolHistoryDatabase, scope: ToolMessageScope): ToolActivity[] {
  // WHY：幂等成功回放的请求可能持有刚生成的 attemptId；必须使用已持久化消息里的权威归属。
  return readHistory(db, scope, true).get(scope.messageId)?.tools ?? [];
}
export function toolReplayEvents(db: ToolHistoryDatabase, scope: ToolMessageScope): Extract<ChatEvent, { type: "tool" }>[] {
  return readCurrentAttemptTools(db, scope).map(tool => ({ type: "tool", tool }));
}
