import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_SPEECH_PREFERENCES, SpeechError, speechPreferencesSchema, type SpeechPreferences } from "./speech";

const storedSchema = z.object({ preferences: speechPreferencesSchema, apiKey: z.string().optional() }).strict();
export type SpeechConfig = { preferences: SpeechPreferences; apiKey: string };
export function createSpeechConfigStore(directory: string, environmentKey: () => string | undefined) {
  const filename = path.join(directory, "speech-settings.json");
  async function read(): Promise<SpeechConfig> {
    try {
      const stored = storedSchema.parse(JSON.parse(await fs.readFile(filename, "utf8")) as unknown);
      return { preferences: stored.preferences, apiKey: stored.apiKey || environmentKey()?.trim() || "" };
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { preferences: { ...DEFAULT_SPEECH_PREFERENCES }, apiKey: environmentKey()?.trim() || "" };
      }
      // WHY：损坏或不可读的配置不得伪装成默认配置，更不能在下一次保存时静默覆盖密钥。
      throw new SpeechError("语音配置无法读取，请检查服务端 speech-settings.json。", 500);
    }
  }
  async function save(preferences: SpeechPreferences, apiKey?: string): Promise<SpeechConfig> {
    const current = await read();
    const next = { preferences: speechPreferencesSchema.parse(preferences), apiKey: apiKey?.trim() || current.apiKey };
    await fs.mkdir(directory, { recursive: true });
    const temporary = filename + "." + randomUUID() + ".tmp";
    try {
      // WHY：原子替换防止进程中断留下半份 JSON；文件位于私有 data，不进入 public 或浏览器存储。
      await fs.writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, filename);
    } catch (error: unknown) {
      try { await fs.unlink(temporary); }
      catch (cleanup: unknown) {
        if (!(cleanup instanceof Error && "code" in cleanup && cleanup.code === "ENOENT")) console.error("清理临时语音配置失败");
      }
      throw error;
    }
    return next;
  }
  return { read, save };
}
export function publicSpeechConfig(config: SpeechConfig) {
  return { ...config.preferences, hasApiKey: Boolean(config.apiKey), model: "mimo-v2.5-tts" };
}
