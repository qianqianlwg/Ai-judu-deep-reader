import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeModelChoices, selectRequestModel, readModelChoices, readModelEntries, saveModelChoices } from "./model-choices";
import { createRequire } from "node:module";
type TestDb = { exec(sql: string): void; close(): void; prepare(sql: string): { get(...args: unknown[]): Record<string, unknown> | undefined; all(...args: unknown[]): Record<string, unknown>[]; run(...args: unknown[]): unknown } };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(file: string) => TestDb };
let directory: string | undefined;
afterEach(async () => { if (directory) { await fs.rm(directory, { recursive: true, force: true }); directory = undefined; } });
describe("model choices", () => {
  it("normalizes legacy delimited lists and validates names and active choices", () => {
    expect(normalizeModelChoices("a\nb;c", "x")).toEqual([{ model: "a", enabled: true }, { model: "b", enabled: true }, { model: "c", enabled: true }]);
    expect(() => normalizeModelChoices([], "x")).toThrow();
    expect(() => normalizeModelChoices([2], "x")).toThrow();
    expect(() => normalizeModelChoices(["a", "a"], "x")).toThrow();
    expect(() => normalizeModelChoices([{ model: "a", enabled: false }], "x")).toThrow();
  });
  it("migrates the old table, persists enabled state, and only offers enabled models", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE ai_model_choices (model TEXT PRIMARY KEY, position INTEGER NOT NULL)");
    db.exec("INSERT INTO ai_model_choices VALUES ('old-model', 0)");
    expect(readModelEntries(db, "fallback")).toEqual([{ model: "old-model", enabled: true }, { model: "fallback", enabled: true }]);
    saveModelChoices(db, [{ model: "a", enabled: true }, { model: "b", enabled: false }]);
    expect(readModelEntries(db, "fallback")).toEqual([{ model: "a", enabled: true }, { model: "b", enabled: false }, { model: "fallback", enabled: true }]);
    expect(readModelChoices(db, "fallback")).toEqual(["a", "fallback"]);
    const config = { provider: "openai" as const, baseUrl: "https://unit.invalid", apiKey: "fake", model: "a" };
    expect(selectRequestModel(config, "a", ["a"]).model).toBe("a");
    expect(() => selectRequestModel(config, "b", ["a"])).toThrow();
    expect(selectRequestModel(config, undefined, [])).toBe(config);
    db.close();
  });
});


it("keeps the current default model enabled even when legacy model choices omit or disable it", () => {
  const db = new DatabaseSync(":memory:");
  saveModelChoices(db, [{ model: "legacy-model", enabled: true }]);
  expect(readModelEntries(db, "current-model")).toEqual([{ model: "legacy-model", enabled: true }, { model: "current-model", enabled: true }]);
  saveModelChoices(db, [{ model: "current-model", enabled: false }, { model: "other-model", enabled: true }]);
  expect(readModelEntries(db, "current-model")).toEqual([{ model: "current-model", enabled: true }, { model: "other-model", enabled: true }]);
  db.close();
});

it("reopens enabled and disabled model rows after a database process restart", async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-model-choices-restart-"));
  const filename = path.join(directory, "settings.sqlite");
  let db = new DatabaseSync(filename);
  try {
    saveModelChoices(db, [
      { model: "model-a", enabled: true },
      { model: "model-b", enabled: false },
      { model: "model-c", enabled: true },
    ]);
    db.close();
    db = new DatabaseSync(filename);
    expect(readModelEntries(db, "model-a")).toEqual([
      { model: "model-a", enabled: true },
      { model: "model-b", enabled: false },
      { model: "model-c", enabled: true },
    ]);
    expect(readModelChoices(db, "model-a")).toEqual(["model-a", "model-c"]);
  } finally {
    db.close();
  }
});