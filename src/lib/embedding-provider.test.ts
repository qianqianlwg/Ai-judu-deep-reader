import { describe, it, expect, vi } from "vitest";
import { embedTexts, validateVector, EMBEDDING_URL, embeddingProfile, EMBEDDING_PROFILE } from "./embedding-provider";

const vector = (value: number) => Array.from({ length: 1024 }, () => value);
const success = () => Response.json({ data: [{ index: 0, embedding: vector(1) }] });

describe("SiliconFlow embedding", () => {
  it("使用固定地址，按 index 重排并发送 1024 维", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [
      { index: 1, embedding: vector(2) }, { index: 0, embedding: vector(1) },
    ] }));
    const result = await embedTexts({ apiKey: "fake-key" }, ["a", "b"], undefined, fetcher);
    expect(result[0][0]).toBe(1);
    expect(fetcher.mock.calls[0][0]).toBe(EMBEDDING_URL);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      model: "Qwen/Qwen3-Embedding-8B", dimensions: 1024, input: ["a", "b"],
    });
  });

  it("拒绝重复序号、无效维度和零向量", async () => {
    expect(() => validateVector([1])).toThrow();
    expect(() => validateVector(vector(0))).toThrow();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [
      { index: 0, embedding: vector(1) }, { index: 0, embedding: vector(2) },
    ] }));
    await expect(embedTexts({ apiKey: "fake" }, ["a", "b"], undefined, fetcher)).rejects.toThrow("序号");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("向用户显示供应商原始诊断，同时隐藏 API Key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: { message: "Invalid API key: private-test-secret", code: "invalid_api_key" } },
      { status: 401 },
    ));
    await expect(embedTexts({ apiKey: "private-test-secret" }, ["简短文本"], undefined, fetcher))
      .rejects.toThrow("HTTP 401：错误代码 invalid_api_key：Invalid API key: [API Key 已隐藏]");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("供应商错误若回显书籍原文则隐藏原文片段", async () => {
    const source = "这段书籍原文不应该被错误提示回显出来";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(
      { error: { message: `invalid request near ${source}` } }, { status: 400 },
    ));
    const request = embedTexts({ apiKey: "fake" }, [source], undefined, fetcher);
    const result = await request.then(() => ({ error: "" }), (cause: unknown) => ({
      error: cause instanceof Error ? cause.message : String(cause),
    }));
    expect(result.error).toContain("服务端错误信息包含书籍原文片段，已隐藏");
    expect(result.error).not.toContain(source);
  });

  it("对 HTTP 429 按 1、2、4 秒指数退让，最多重试三次", async () => {
    const delays: number[] = [];
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 }))
      .mockResolvedValueOnce(success());
    const result = await embedTexts({ apiKey: "fake" }, ["a"], undefined, fetcher, undefined, async delay => { delays.push(delay); });
    expect(result[0][0]).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });

  it("网络异常最多重试三次并显示最后原始错误", async () => {
    const delays: number[] = [];
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed: DNS unavailable"));
    await expect(embedTexts({ apiKey: "fake" }, ["a"], undefined, fetcher, undefined, async delay => { delays.push(delay); }))
      .rejects.toThrow("向量服务连接失败或超时：fetch failed: DNS unavailable（已重试 3 次）");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
  });
});

it("uses the configured OpenAI-compatible model and dimensions, including automatic dimension detection",async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{index:0,embedding:[0.2,0.3,0.5]}]}));const config={apiKey:"fake",baseUrl:"https://vectors.example/v1/embeddings",model:"custom-embed",dimensions:null};const result=await embedTexts(config,["query"],undefined,fetcher);expect(result[0]).toEqual([0.2,0.3,0.5]);expect(fetcher.mock.calls[0][0]).toBe("https://vectors.example/v1/embeddings");const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(body).toMatchObject({model:"custom-embed",input:["query"]});expect(body).not.toHaveProperty("dimensions");expect(validateVector([1,2,3],null)).toEqual([1,2,3]);expect(embeddingProfile({apiKey:"x"})).toBe(EMBEDDING_PROFILE);expect(embeddingProfile(config)).not.toBe(EMBEDDING_PROFILE);});


it("reports a clear error when one embedding batch mixes vector dimensions", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [
    { index: 0, embedding: [0.1, 0.2] },
    { index: 1, embedding: [0.1, 0.2, 0.3] },
  ] }));
  await expect(embedTexts({ apiKey: "fake", dimensions: null }, ["first", "second"], undefined, fetcher))
    .rejects.toThrow("同一批次的向量维度不一致，无法安全建立索引");
});
