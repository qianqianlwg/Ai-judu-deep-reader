import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
const original = process.env.OPENALEX_API_KEY, brave = process.env.TAVILY_API_KEY;
afterEach(() => { if (original === undefined) delete process.env.OPENALEX_API_KEY; else process.env.OPENALEX_API_KEY = original; if (brave === undefined) delete process.env.BRAVE_SEARCH_API_KEY; else process.env.BRAVE_SEARCH_API_KEY = brave; });
describe("外部来源状态", () => { it("仅公开可用性，不回传密钥", async () => {
  process.env.OPENALEX_API_KEY = "secret-a"; delete process.env.BRAVE_SEARCH_API_KEY;
  const response = GET(); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ available: { openalex: true, crossref: true, web: false } });
  delete process.env.OPENALEX_API_KEY; expect(await GET().json()).toEqual({ available: { openalex: true, crossref: true, web: false } });
}); });
