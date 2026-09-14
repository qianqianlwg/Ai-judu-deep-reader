import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPostgresSearchQuery, type PostgresSearchOptions, type PostgresSearchRow } from "./postgres-search";

const mocked = vi.hoisted(() => ({
  query: vi.fn<(text: string, values: unknown[]) => Promise<{ rows: unknown[] }>>(),
  constructed: vi.fn<(options: { connectionString?: string; max: number }) => void>(),
}));
// WHY：在 pg 模块边界替换 Pool，绝不建立真实连接；SQL 仍由实际 query builder 生成。
vi.mock("pg", () => ({ Pool: class {
  query = mocked.query;
  constructor(options: { connectionString?: string; max: number }) { mocked.constructed(options); }
} }));
let client: typeof import("./postgres-search-client");
const options: PostgresSearchOptions = { query: "劳动", editionId: "edition-a", chapterId: "chapter-a",
  sourceType: "book", limit: 5, embedding: [0.1, 0.2] };

beforeEach(async () => {
  vi.resetModules(); mocked.query.mockReset(); mocked.constructed.mockReset();
  mocked.query.mockResolvedValue({ rows: [] });
  vi.stubEnv("DATABASE_URL", "postgresql://unit.invalid/not-connected");
  client = await import("./postgres-search-client");
});
afterEach(() => vi.unstubAllEnvs());

describe("PostgreSQL search client · mock Pool", () => {
  it("惰性创建连接池并原样传递混合检索 SQL、版本/章节过滤和参数", async () => {
    expect(mocked.constructed).not.toHaveBeenCalled();
    const rows: PostgresSearchRow[] = [{ paragraphId: "p1", chapterId: "chapter-a", chapterTitle: "第一章",
      text: "实际查询结果", keywordScore: 0.5, vectorSimilarity: 0.8, rrfScore: 0.02 }];
    mocked.query.mockResolvedValueOnce({ rows });
    expect(await client.searchPostgres(options)).toBe(rows);
    const expected = buildPostgresSearchQuery(options);
    expect(mocked.query).toHaveBeenCalledWith(expected.text, expected.values);
    expect(expected.values).toEqual(["劳动", "edition-a", "chapter-a", "book", 25, "[0.1,0.2]",
      "edition-a", "chapter-a", "book", 25, 60, 5]);
    expect(mocked.constructed).toHaveBeenCalledWith({ connectionString: "postgresql://unit.invalid/not-connected", max: 4 });
  });
  it("查询与状态统计复用同一 Pool，不为每次请求新建连接池", async () => {
    await client.searchPostgres({ query: "概念", editionId: "edition-a", limit: 2 });
    await client.getPostgresSearchIndexStatus("edition-a");
    expect(mocked.constructed).toHaveBeenCalledTimes(1);
    expect(mocked.query).toHaveBeenCalledTimes(2);
  });
  it("引号/注入式查询和 editionId 只能进入参数，不能拼入 SQL", async () => {
    const editionId = "edition' OR 1=1 --", query = "term'; DROP TABLE books; --";
    await client.searchPostgres({ query, editionId, limit: 2 });
    const [text, values] = mocked.query.mock.calls[0];
    expect(text).not.toContain(query); expect(text).not.toContain(editionId);
    expect(values).toEqual([query, editionId, 10, 60, 2]);
  });
  it("查询错误原样上抛，不伪装成空结果或在 client 内悄悄降级", async () => {
    const error = new Error("mock connection refused");
    mocked.query.mockRejectedValueOnce(error);
    await expect(client.searchPostgres(options)).rejects.toBe(error);
  });
  it("非法 limit 或 embedding 在连接池创建前拒绝", async () => {
    await expect(client.searchPostgres({ ...options, limit: 0 })).rejects.toThrow("正整数");
    await expect(client.searchPostgres({ ...options, embedding: [Number.NaN] })).rejects.toThrow("有限数字");
    expect(mocked.constructed).not.toHaveBeenCalled(); expect(mocked.query).not.toHaveBeenCalled();
  });
  it("无命中原样返回空数组，不能捏造检索内容", async () => {
    expect(await client.searchPostgres(options)).toEqual([]);
  });
  it("状态查询按 editionId 绑定参数，返回实际 total 与非空 embedding 数", async () => {
    mocked.query.mockResolvedValueOnce({ rows: [{ paragraphCount: "217", indexedCount: "13" }] });
    expect(await client.getPostgresSearchIndexStatus("edition-a")).toEqual({ paragraphCount: 217, indexedCount: 13 });
    const [text, values] = mocked.query.mock.calls[0];
    expect(text).toContain('COUNT(*)::int AS "paragraphCount"');
    expect(text).toContain('COUNT(embedding)::int AS "indexedCount"');
    expect(text).toContain("WHERE edition_id = $1"); expect(values).toEqual(["edition-a"]);
  });
  it("只存在关键词记录时 indexedCount 必须保留 0，不能等于段落总数", async () => {
    mocked.query.mockResolvedValueOnce({ rows: [{ paragraphCount: 42, indexedCount: 0 }] });
    expect(await client.getPostgresSearchIndexStatus("edition-keyword")).toEqual({ paragraphCount: 42, indexedCount: 0 });
  });
  it("缺少统计行的当前契约为两个 0", async () => {
    expect(await client.getPostgresSearchIndexStatus("missing")).toEqual({ paragraphCount: 0, indexedCount: 0 });
  });
  it("统计失败原样上抛，不能用 0 掩盖连接错误", async () => {
    const error = new Error("mock count query failed");
    mocked.query.mockRejectedValueOnce(error);
    await expect(client.getPostgresSearchIndexStatus("edition-a")).rejects.toBe(error);
  });
});
