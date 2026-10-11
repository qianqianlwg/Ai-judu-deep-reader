export const TOOL_NAMES = {
  searchBook: "search_book",
  readSource: "read_source",
  saveReadingAnalysis: "save_reading_analysis",
  markAnswerEmphasis: "mark_answer_emphasis",
  submitReadingSentence: "submit_reading_sentence",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export function namedToolChoice<const TName extends string>(name: TName): { tool_choice: TName } {
  if (!name.trim()) throw new Error("工具名称不能为空");
  // WHY：只有需要单一结构化结果的步骤才强制指定工具；普通阅读 Agent 仍由模型在工具集合中自主选择。
  return { tool_choice: name };
}
