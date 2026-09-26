import { z } from "zod";

export const SPEECH_VOICES = ["mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"] as const;
export const speechPreferencesSchema = z.object({
  voice: z.enum(SPEECH_VOICES),
  playbackRate: z.number().min(0.5).max(2),
  volume: z.number().min(0).max(1),
  style: z.string().trim().max(500),
}).strict();
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>;
export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  voice: "mimo_default", playbackRate: 1, volume: 1, style: "自然、清晰地朗读，适当停顿，不添加原文之外的内容。",
};
export const MAX_SPEECH_CHUNK = 1200;
export const MAX_SPEECH_TEXT = 30000;
export class SpeechError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "SpeechError"; }
}

export function splitSpeechText(text: string): string[] {
  const characters = Array.from(text.trim());
  if (!characters.length) throw new SpeechError("没有可以朗读的文本。");
  if (characters.length > MAX_SPEECH_TEXT) throw new SpeechError("单次朗读最多支持 30000 字符，请分段选择。");
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length;) {
    let end = Math.min(offset + MAX_SPEECH_CHUNK, characters.length);
    if (end < characters.length) {
      // WHY：优先在句尾分段，避免长 AI 回答超过单次合成上限，同时不丢失或重复原文。
      for (let index = end - 1; index >= offset + MAX_SPEECH_CHUNK / 2; index--) {
        if (/[。！？.!?；;\n]/u.test(characters[index])) { end = index + 1; break; }
      }
    }
    chunks.push(characters.slice(offset, end).join("")); offset = end;
  }
  return chunks;
}

export function speechPlainText(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/gu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gmu, "")
    .replace(/[*_`~]+/gu, "").trim();
}
