export type AgentLogLevel = "info" | "warn" | "error";
function printable(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => printable(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|authorization|password|secret|(?:^|_)(?:access|refresh)?token$/i.test(key)) { result[key] = "[redacted]"; continue; }
      result[key] = printable(item, depth + 1);
    }
    return result;
  }
  return String(value);
}
export function logAgentEvent(level: AgentLogLevel, event: string, data: Record<string, unknown> = {}): void {
  const payload = JSON.stringify({ at: new Date().toISOString(), event, ...printable(data) as Record<string, unknown> });
  if (level === "error") console.error("[judu-agent]", payload);
  else if (level === "warn") console.warn("[judu-agent]", payload);
  else console.info("[judu-agent]", payload);
}
