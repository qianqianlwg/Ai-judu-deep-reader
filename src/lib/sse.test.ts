import { describe, expect, it } from "vitest";
import { parseSseBlock } from "./sse";
describe("SSE", () => { it("解析句读流事件", () => { expect(parseSseBlock('event: raw_delta\ndata: {"text":"句"}')).toEqual({ event: "raw_delta", data: '{"text":"句"}' }); }); });
