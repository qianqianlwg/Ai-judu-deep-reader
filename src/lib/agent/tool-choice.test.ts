import { describe, expect, it } from "vitest";
import { namedToolChoice, TOOL_NAMES } from "./tool-choice";

describe("tool choice policy", () => {
  it("keeps named tool choices aligned with registered tool names", () => {
    expect(namedToolChoice(TOOL_NAMES.submitReadingSentence)).toEqual({ tool_choice: "submit_reading_sentence" });
  });

  it("rejects an empty forced tool name instead of sending an invalid request", () => {
    expect(() => namedToolChoice("  ")).toThrow("工具名称不能为空");
  });
});
