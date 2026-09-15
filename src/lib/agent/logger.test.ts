import { afterEach, describe, expect, it, vi } from "vitest";
import { logAgentEvent } from "./logger";
afterEach(()=>vi.restoreAllMocks());
describe("Agent日志",()=>{it("结构化记录并脱敏敏感字段",()=>{const spy=vi.spyOn(console,"info").mockImplementation(()=>undefined);logAgentEvent("info","tool_failed",{name:"save_reading_analysis",apiKey:"secret",selectedTextLength:10});expect(spy).toHaveBeenCalledWith("[judu-agent]",expect.stringContaining("tool_failed"));expect(spy.mock.calls[0][1]).toContain("[redacted]");expect(spy.mock.calls[0][1]).not.toContain("secret");});});
