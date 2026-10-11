import type { ProviderConfig } from "./ai-provider";
export type ModelChoice = { model: string; enabled: boolean };
type Store = { exec(sql: string): void; prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown } };
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function modelError(message: string): Error { return new Error(message); }

export function normalizeModelChoices(value: unknown, fallback: string): ModelChoice[] {
  const raw = value === undefined ? [fallback] : typeof value === "string" ? value.split(/[\n,;\uFF0C\uFF1B]+/u) : value;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) throw modelError("\u8bf7\u63d0\u4f9b 1\u201350 \u4e2a\u6a21\u578b\u3002");
  const seen = new Set<string>();
  const choices: ModelChoice[] = [];
  for (const item of raw) {
    let model: string;
    let enabled = true;
    if (typeof item === "string") model = item.trim();
    else if (isRecord(item) && typeof item.model === "string" && (item.enabled === undefined || typeof item.enabled === "boolean")) { model = item.model.trim(); enabled = item.enabled !== false; }
    else throw modelError("\u6a21\u578b\u5217\u8868\u6570\u636e\u65e0\u6548\u3002");
    if (!model || model.length > 200 || /[\r\n\x00-\x1f]/u.test(model)) throw modelError("\u6a21\u578b\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a\uff0c\u4e14\u4e0d\u80fd\u8d85\u8fc7 200 \u4e2a\u5b57\u7b26\u3002");
    if (seen.has(model)) throw modelError("\u6a21\u578b\u540d\u79f0\u4e0d\u80fd\u91cd\u590d\u3002");
    seen.add(model); choices.push({ model, enabled });
  }
  if (!choices.some(choice => choice.enabled)) throw modelError("\u81f3\u5c11\u542f\u7528\u4e00\u4e2a\u6a21\u578b\u3002");
  return choices;
}

function ensure(db: Store): void {
  db.exec("CREATE TABLE IF NOT EXISTS ai_model_choices (model TEXT PRIMARY KEY, position INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))");
  const columns = db.prepare("PRAGMA table_info(ai_model_choices)").all();
  if (!columns.some(column => isRecord(column) && column.name === "enabled")) db.exec("ALTER TABLE ai_model_choices ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))");
}

export function readModelEntries(db: Store, fallback: string): ModelChoice[] {
  ensure(db);
  const rows = db.prepare("SELECT model, enabled FROM ai_model_choices ORDER BY position").all();
  const stored: ModelChoice[] = rows.map(row => {
    if (!isRecord(row) || typeof row.model !== "string" || (row.enabled !== 0 && row.enabled !== 1)) throw modelError("\u5df2\u4fdd\u5b58\u7684\u6a21\u578b\u5217\u8868\u65e0\u6548\u3002");
    return { model: row.model, enabled: row.enabled === 1 };
  });
  if (!stored.length) return normalizeModelChoices([fallback], fallback);
  const fallbackIndex = stored.findIndex(choice => choice.model === fallback);
  if (fallbackIndex >= 0) {
    // WHY：历史表可能把当前 Provider 默认模型标成停用；默认项仍必须能被 UI 选择并保存。
    return normalizeModelChoices(stored.map((choice, index) => index === fallbackIndex ? { ...choice, enabled: true } : choice), fallback);
  }
  // WHY：旧模型列表可能早于当前 Provider 默认值；补入该默认项，避免下拉框指向一个不可用模型。
  return normalizeModelChoices(stored.length < 50 ? [...stored, { model: fallback, enabled: true }] : stored, fallback);
}

export function readModelChoices(db: Store, fallback: string): string[] {
  return readModelEntries(db, fallback).filter(choice => choice.enabled).map(choice => choice.model);
}

export function saveModelChoices(db: Store, choices: readonly ModelChoice[]): void {
  const normalized = normalizeModelChoices(choices, choices[0]?.model ?? "");
  ensure(db);
  db.prepare("DELETE FROM ai_model_choices").run();
  normalized.forEach((choice, position) => db.prepare("INSERT INTO ai_model_choices (model, position, enabled) VALUES (?, ?, ?)").run(choice.model, position, choice.enabled ? 1 : 0));
}

export function selectRequestModel(config: ProviderConfig, requested: unknown, choices: readonly string[]): ProviderConfig {
  if (requested === undefined) return config;
  if (typeof requested !== "string" || !choices.includes(requested)) throw new Error("\u8be5\u6a21\u578b\u672a\u5728\u8bbe\u7f6e\u4e2d\u542f\u7528\uff0c\u8bf7\u5237\u65b0\u6a21\u578b\u5217\u8868");
  return { ...config, model: requested };
}
