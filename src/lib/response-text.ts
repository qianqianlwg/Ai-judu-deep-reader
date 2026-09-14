export type ResponsesPayload = { output_text?: string; output?: Array<{ content?: unknown }> };
type TextPart = { text?: string };

export function readResponseText(data: ResponsesPayload): string {
  if (data.output_text) return data.output_text;
  return data.output?.flatMap((item) => {
    if (Array.isArray(item.content)) return item.content as TextPart[];
    return item.content && typeof item.content === "object" ? [item.content as TextPart] : [];
  }).map((item) => item.text || "").join("") || "";
}
