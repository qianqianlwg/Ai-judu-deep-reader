import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSpeechConfigStore, publicSpeechConfig } from "./speech-config";
import { DEFAULT_SPEECH_PREFERENCES } from "./speech";
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-speech-test-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
it("未保存时使用环境密钥，但公开配置不含密钥", async () => {
  const store = createSpeechConfigStore(directory, () => "unit-only-key");
  const config = await store.read(); expect(config.apiKey).toBe("unit-only-key");
  const value = publicSpeechConfig(config); expect(value.hasApiKey).toBe(true); expect(JSON.stringify(value)).not.toContain("unit-only-key"); expect(value).not.toHaveProperty("apiKey");
});
it("保存、空密钥保留、替换密钥和重读保持一致", async () => {
  const store = createSpeechConfigStore(directory, () => "env-unit-key");
  await store.save({ ...DEFAULT_SPEECH_PREFERENCES, voice: "苏打" }, "saved-unit-key");
  await store.save({ ...DEFAULT_SPEECH_PREFERENCES, voice: "白桦" }, "  ");
  expect(await store.read()).toMatchObject({ apiKey: "saved-unit-key", preferences: { voice: "白桦" } });
  await store.save(DEFAULT_SPEECH_PREFERENCES, "replacement-unit-key");
  expect((await store.read()).apiKey).toBe("replacement-unit-key");
  expect(await fs.readdir(directory)).toEqual(["speech-settings.json"]);
});
it("损坏配置报错而不是恢复默认并覆盖", async () => {
  await fs.writeFile(path.join(directory, "speech-settings.json"), "invalid-json");
  const store = createSpeechConfigStore(directory, () => "unit-key");
  await expect(store.read()).rejects.toThrow("无法读取");
  await expect(store.save(DEFAULT_SPEECH_PREFERENCES)).rejects.toThrow("无法读取");
  expect(await fs.readFile(path.join(directory, "speech-settings.json"), "utf8")).toBe("invalid-json");
});
