import { describe, expect, it } from "vitest";
import { defaultExternalPreferences, permittedExternalSources, readExternalPreferences, writeExternalPreferences } from "./external-preferences";

describe("外部资料持久偏好", () => {
  it("首次默认开启；后续取消选项刷新仍保留", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(readExternalPreferences(storage)).toEqual(defaultExternalPreferences());
    writeExternalPreferences(storage, { openalex: true, crossref: false, web: true });
    expect(readExternalPreferences(storage)).toEqual({ openalex: true, crossref: false, web: true });
  });
  it("只把实际可用且用户允许的来源发给服务端", () => {
    expect(permittedExternalSources(defaultExternalPreferences(), { openalex: true, crossref: false, web: true })).toEqual({ openalex: true, crossref: false, web: true });
    expect(permittedExternalSources({ openalex: false, crossref: true, web: true }, { openalex: true, crossref: true, web: false })).toEqual({ openalex: false, crossref: true, web: false });
  });
  it("损坏的持久值必须报错而非悄悄扩权", () => {
    expect(() => readExternalPreferences({ getItem: () => '{"web":true}' })).toThrow("授权格式无效");
  });
});
