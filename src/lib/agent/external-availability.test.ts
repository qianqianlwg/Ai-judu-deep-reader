import { describe, expect, it } from "vitest";
import { externalAvailability } from "./external-availability";
describe("来源配置", () => { it("OpenAlex 匿名与 Crossref 可用，网页搜索仍需密钥", () => { expect(externalAvailability({})).toEqual({ openalex: true, crossref: true, web: false }); expect(externalAvailability({ OPENALEX_API_KEY: "k", TAVILY_API_KEY: "w" })).toEqual({ openalex: true, crossref: true, web: true }); }); });
