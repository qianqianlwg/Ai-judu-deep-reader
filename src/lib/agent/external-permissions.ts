export const externalSources = ["openalex", "crossref", "web"] as const;
export type ExternalSource = typeof externalSources[number];
export type ExternalPermissions = Record<ExternalSource, boolean>;
export const emptyExternalPermissions = (): ExternalPermissions => ({ openalex: false, crossref: false, web: false });
export function readExternalPermissions(value: unknown): ExternalPermissions {
  if (value === undefined) return emptyExternalPermissions();
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("外部资料授权格式无效");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !externalSources.includes(key as ExternalSource)) || externalSources.some(key => typeof record[key] !== "boolean")) throw new Error("外部资料授权格式无效");
  return { openalex: record.openalex as boolean, crossref: record.crossref as boolean, web: record.web as boolean };
}
