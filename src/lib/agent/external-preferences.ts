import { externalSources, readExternalPermissions, type ExternalPermissions } from "./external-permissions";

const KEY = "judu:external-sources:v1";
export const defaultExternalPreferences = (): ExternalPermissions => ({ openalex: true, crossref: true, web: true });

export function readExternalPreferences(storage: Pick<Storage, "getItem">): ExternalPermissions {
  const saved = storage.getItem(KEY);
  // WHY：新用户默认启用已配置来源；服务端可用性与持久偏好分离，缺 Key 不会让授权请求误报成功。
  return saved === null ? defaultExternalPreferences() : readExternalPermissions(JSON.parse(saved) as unknown);
}

export function writeExternalPreferences(storage: Pick<Storage, "setItem">, preferences: ExternalPermissions): void {
  storage.setItem(KEY, JSON.stringify(readExternalPermissions(preferences)));
}

export function permittedExternalSources(preferences: ExternalPermissions, available: ExternalPermissions): ExternalPermissions {
  return Object.fromEntries(externalSources.map(source => [source, preferences[source] && available[source]])) as ExternalPermissions;
}
