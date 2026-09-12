import { describe, expect, it } from "vitest";
import { getDb } from "./db";

describe("getDb", () => {
  it("延迟创建并返回同一个连接", () => {
    const first = getDb();
    expect(first).toBe(getDb());
    expect(first!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'").get()).toBeTruthy();
  });
});

