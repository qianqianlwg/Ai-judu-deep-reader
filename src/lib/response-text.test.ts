import { describe, expect, it } from "vitest";
import { readResponseText } from "./response-text";
describe("Responses 文本提取", () => { it("支持 output_text", () => { expect(readResponseText({ output_text: "测试" })).toBe("测试"); }); it("支持 content 数组", () => { expect(readResponseText({ output: [{ content: [{ text: "句" }, { text: "读" }] }] })).toBe("句读"); }); });
