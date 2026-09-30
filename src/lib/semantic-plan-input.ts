export class SemanticPlanError extends Error {
  readonly code = 'semantic_plan_invalid';
  constructor(message: string) { super(message); this.name = 'SemanticPlanError'; }
}
// WHY：兼容网关把数组再次编码成 JSON 字符串时仅做无损解码；残缺 JSON 不补引号、不执行、不当作可发布计划。
export function decodeSemanticPlan(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('units' in value)) return value;
  if (typeof value.units !== 'string') return value;
  try { return {...value, units:JSON.parse(value.units) as unknown}; }
  catch { throw new Error('units 必须是 JSON 数组，不是字符串。上次字符串内 JSON 也不合法；请直接输出 {"units":[{...}]}，逐字引文中的双引号须按 JSON 规则转义。'); }
}
