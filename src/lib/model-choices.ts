import type {ProviderConfig} from './ai-provider';
type Store = {exec(sql:string):void;prepare(sql:string):{all(...args:unknown[]):unknown[];run(...args:unknown[]):unknown}};
export function normalizeModelChoices(value: unknown, fallback: string): string[] {
  const values = value === undefined ? [fallback] : typeof value === 'string' ? value.split(/[\n,，;；]+/u) : value;
  if (!Array.isArray(values) || values.some(item=>typeof item !== 'string')) throw new Error('模型列表必须是文字列表');
  const models = [...new Set((values as string[]).map(item=>item.trim()).filter(Boolean))];
  if (!models.length || models.length > 50 || models.some(item=>item.length>200 || /[\r\n\x00-\x1f]/u.test(item))) throw new Error('请填写 1–50 个有效模型名称，每个不超过 200 字');
  return models;
}
function ensure(db: Store) {
  // WHY：同步 SQLite schema 引导与配置写入保持一致；增量新表不修改既有模型密钥和历史消息。
  db.exec('CREATE TABLE IF NOT EXISTS ai_model_choices (model TEXT PRIMARY KEY, position INTEGER NOT NULL)');
}
export function readModelChoices(db: Store, fallback: string): string[] {
  ensure(db);
  const rows=db.prepare('SELECT model FROM ai_model_choices ORDER BY position').all();
  const models=rows.map(row=>row && typeof row==='object' && 'model' in row && typeof row.model==='string'?row.model:'').filter(Boolean);
  return [...new Set([fallback,...models])];
}
export function saveModelChoices(db: Store, models: string[]): void {
  ensure(db); db.prepare('DELETE FROM ai_model_choices').run();
  models.forEach((model,position)=>db.prepare('INSERT INTO ai_model_choices (model,position) VALUES (?,?)').run(model,position));
}
export function selectRequestModel(config: ProviderConfig, requested: unknown, choices: readonly string[]): ProviderConfig {
  if (requested === undefined) return config;
  if (typeof requested !== 'string' || !choices.includes(requested)) throw new Error('该模型未在设置中配置，请刷新模型列表');
  return {...config,model:requested};
}
