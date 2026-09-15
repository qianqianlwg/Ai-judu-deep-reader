import { expect, it } from "vitest";
import { diagnoseToolException, publicToolFailure } from "./diagnostics";
it("旧概念校验失败刷新后仍有明确原因",()=>{expect(publicToolFailure({ok:false,error:"以下概念未逐字出现在选文中，请修正"})).toMatchObject({code:"invalid_concepts"});});
it("不返回未知异常、工具参数或密钥",()=>{expect(publicToolFailure({ok:false,error:"Authorization: secret"})).toBeUndefined();const d=diagnoseToolException("save_reading_analysis",{apiKey:"secret",readingText:3});expect(d.code).toBe("tool_schema_invalid");expect(JSON.stringify(d)).not.toContain("secret");expect(d.fields).toContain("readingText");});
