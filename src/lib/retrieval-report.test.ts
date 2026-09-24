import { describe, expect, it } from "vitest";
import { readRetrievalReport } from "./retrieval-report";
describe("检索展示契约", () => {
  const report = {version:1,requestedMode:"auto",effectiveMode:"keyword",queries:["自由"],branches:[{query:"自由",strategy:"keyword",status:"completed",count:1,durationMs:2}],durationMs:2,sourceCount:1,degraded:false};
  it("校验服务端报告，不把任意工具 JSON 作为检索详情", () => {expect(readRetrievalReport(report)?.sourceCount).toBe(1);expect(readRetrievalReport({...report,apiKey:"secret"})).toBeUndefined();expect(readRetrievalReport({...report,durationMs:NaN})).toBeUndefined();});
});
