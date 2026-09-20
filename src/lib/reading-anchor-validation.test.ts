import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { getDb } from "./db";
import { verifySelectionAnchors } from "./reading-anchor-validation";
import type { ReadingAnchorPart } from "./reading-anchors";

type Db = ReturnType<typeof getDb>;
type SelectionInput = Parameters<typeof verifySelectionAnchors>[1];
const runtime = (process as unknown as {
  getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db };
}).getBuiltinModule("node:sqlite");
const paragraphs = [
  { id: "p1", chapterId: "chapter-z", text: "开头第一段保留完整的正文。", order: 10 },
  { id: "p2", chapterId: "chapter-z", text: "中间第二段不能漏掉任何文字。", order: 40 },
  { id: "p3", chapterId: "chapter-z", text: "本章第三段随后连接下一章。", order: 80 },
  { id: "p4", chapterId: "chapter-a", text: "序😀𠮷新章正文结尾。", order: 5 },
  { id: "p5", chapterId: "chapter-a", text: "下一章第二段的完整原文。", order: 30 },
] as const;
let db: Db;

function part(id: string, startOffset = 0, endOffset?: number): ReadingAnchorPart {
  const row = db.prepare("SELECT text FROM paragraphs WHERE id = ?").get(id) as { text: string };
  const end = endOffset ?? row.text.length;
  return { paragraphId: id, startOffset, endOffset: end, selectedText: row.text.slice(startOffset, end) };
}
function input(parts: ReadingAnchorPart[], overrides: Partial<SelectionInput> = {}): SelectionInput {
  const first = parts[0];
  return {
    editionId: "edition-1", bookId: "book-1", chapterId: "chapter-z",
    paragraphId: first?.paragraphId ?? null, selectionStart: first?.startOffset ?? null,
    selectionEnd: first?.endOffset ?? null,
    // WHY：验收期望独立构造，不调用被测模块的 join/make 辅助函数掩盖拼接或导航错误。
    selectedText: parts.map(value => value.selectedText).join("\n\n"), selectionAnchors: parts,
    ...overrides,
  };
}
function verify(parts: ReadingAnchorPart[], overrides: Partial<SelectionInput> = {}) {
  return verifySelectionAnchors(db, input(parts, overrides));
}

beforeEach(() => {
  // WHY：真实内存 SQLite 覆盖版本 JOIN 和排序；同步调用沿用生产事务语义，不读取正式 data。
  db = new runtime.DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY);
    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, text TEXT NOT NULL, order_index INTEGER NOT NULL);
    INSERT INTO books VALUES ('book-1'), ('book-2');
    INSERT INTO editions VALUES ('edition-1','book-1'), ('edition-2','book-1'), ('edition-3','book-2');
    INSERT INTO chapters VALUES ('chapter-a','edition-1',20), ('chapter-z','edition-1',2),
      ('chapter-other-edition','edition-2',0), ('chapter-other-book','edition-3',0);
  `);
  const insert = db.prepare("INSERT INTO paragraphs VALUES (?, ?, ?, ?)");
  // WHY：倒序插入和稀疏 order_index，防止测试偶然依赖 rowid 或连续数字而非实际阅读次序。
  for (const row of [...paragraphs].reverse()) insert.run(row.id, row.chapterId, row.text, row.order);
  insert.run("other-edition", "chapter-other-edition", paragraphs[1].text, 0);
  insert.run("other-book", "chapter-other-book", paragraphs[1].text, 0);
});
afterEach(() => db.close());

describe("verifySelectionAnchors：真实 SQLite 多段来源验收", () => {
  it("同版连续多段返回 v2 全部片段，顶层严格保留首段局部导航", () => {
    const parts = [part("p1", 2), part("p2"), part("p3", 0, 6)];
    expect(verify(parts)).toEqual({ ...parts[0], version: 2, fragments: parts });
  });
  it("允许同版连续跨章，不要求后续片段仍属于首章", () => {
    const parts = [part("p3", 3), part("p4"), part("p5", 0, 4)];
    expect(verify(parts)).toEqual({ ...parts[0], version: 2, fragments: parts });
  });
  it("单段局部选文兼容旧导航结构", () => {
    const selected = part("p1", 2, 8);
    expect(verify([selected])).toEqual(selected);
  });
  it("允许省略可选书籍与章节，但仍受当前版本约束", () => {
    const parts = [part("p3", 2), part("p4", 0, 5)];
    expect(verify(parts, { bookId: null, chapterId: null })).toEqual({ ...parts[0], version: 2, fragments: parts });
    expect(verify([part("other-book")], { bookId: null, chapterId: null })).toBeNull();
  });
  it("数据库仅被查询，验证不修改原文、章节或版本", () => {
    const before = db.prepare("SELECT * FROM paragraphs ORDER BY id").all();
    const changes = db.prepare("SELECT total_changes() AS count").get();
    verify([part("p1"), part("p2")]);
    verify([part("p1"), part("p3")]);
    expect(db.prepare("SELECT * FROM paragraphs ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
  });

  it.each([
    ["跳过中间段", ["p1", "p3"]],
    ["同章乱序", ["p2", "p1"]],
    ["跨章回退", ["p4", "p3"]],
    ["完整段重复", ["p1", "p1"]],
    ["后续段重复", ["p1", "p2", "p2"]],
  ])("拒绝%s，即使拼接原文逐字正确", (_name, ids) => {
    expect(verify(ids.map(id => part(id)), { chapterId: null })).toBeNull();
  });
  it("拒绝同段重叠片段", () => {
    expect(verify([part("p1", 1), part("p1", 0, 8)])).toBeNull();
  });
  it("拒绝把同段相邻子串伪装成跨段，不允许插入虚假段间分隔", () => {
    expect(verify([part("p1", 0, 5), part("p1", 5)])).toBeNull();
  });
  it.each([
    ["首段尾部缺字", () => [part("p1", 2, paragraphs[0].text.length - 1), part("p2")]],
    ["末段头部缺字", () => [part("p1", 2), part("p2", 1, 8)]],
    ["中间段头部缺字", () => [part("p1", 2), part("p2", 1), part("p3", 0, 5)]],
    ["中间段尾部缺字", () => [part("p1", 2), part("p2", 0, paragraphs[1].text.length - 1), part("p3", 0, 5)]],
  ])("拒绝%s，但不把首段头部/末段尾部合法局部选择误判为缺字", (_name, getParts) => {
    expect(verify(getParts())).toBeNull();
  });
  it("拒绝等长篡改，不能仅凭长度或顶层拼接相等通过", () => {
    const changed = { ...part("p2"), selectedText: "假" + paragraphs[1].text.slice(1) };
    expect(verify([part("p1"), changed])).toBeNull();
  });
  it("拒绝对正文空白做未经授权的归一化", () => {
    db.prepare("UPDATE paragraphs SET text=? WHERE id='p2'").run("保留 空格与\t制表原文。");
    const selected = part("p2");
    expect(verify([selected])).toEqual(selected);
    expect(verify([{ ...selected, selectedText: selected.selectedText.replace("\t", " ") }])).toBeNull();
  });

  it.each([
    ["同书另一版本", "other-edition"], ["另一书籍", "other-book"],
  ])("拒绝混入%s，哪怕原文与正确的第二段完全相同", (_name, id) => {
    expect(verify([part("p1"), part(id)])).toBeNull();
  });
  it("拒绝整份选区版本错配及不存在版本", () => {
    const parts = [part("p1"), part("p2")];
    expect(verify(parts, { editionId: "edition-2" })).toBeNull();
    expect(verify(parts, { editionId: "missing-edition" })).toBeNull();
  });
  it("拒绝顶层书籍错配，即使所有片段属于正确版本", () => {
    expect(verify([part("p1"), part("p2")], { bookId: "book-2" })).toBeNull();
  });
  it("跨章时顶层 chapterId 必须指向首片段，不能指向最后一章", () => {
    expect(verify([part("p3"), part("p4")], { chapterId: "chapter-a" })).toBeNull();
  });
  it("拒绝不存在的片段 ID", () => {
    expect(verify([part("p1"), { ...part("p2"), paragraphId: "missing" }])).toBeNull();
  });

  it.each([
    ["paragraphId 指向第二段", { paragraphId: "p2" }],
    ["selectionStart 与首段不同", { selectionStart: 0 }],
    ["selectionEnd 使用拼接长度", { selectionEnd: 99 }],
    ["缺少 paragraphId", { paragraphId: null }],
    ["缺少 selectionStart", { selectionStart: null }],
    ["缺少 selectionEnd", { selectionEnd: null }],
  ] satisfies [string, Partial<SelectionInput>][])("拒绝顶层不一致：%s", (_name, override) => {
    expect(verify([part("p1", 2), part("p2", 0, 5)], override)).toBeNull();
  });
  it.each(["只保留第一段", "少一个分隔换行", "尾部额外空格", "重排文本"])("拒绝顶层 selectedText 不一致：%s", kind => {
    const parts = [part("p1", 2), part("p2", 0, 5)];
    const text = parts.map(value => value.selectedText).join("\n\n");
    const selectedText = kind === "只保留第一段" ? parts[0].selectedText
      : kind === "少一个分隔换行" ? text.replace("\n\n", "\n")
      : kind === "尾部额外空格" ? text + " " : parts.map(value => value.selectedText).reverse().join("\n\n");
    expect(verify(parts, { selectedText })).toBeNull();
  });
  it("拒绝空片段数组", () => expect(verify([])).toBeNull());
  it.each([
    ["负偏移", { startOffset: -1 }], ["小数偏移", { startOffset: 0.5 }],
    ["空范围", { endOffset: 0, selectedText: "" }],
    ["文本长度与偏移不同", { endOffset: 1 }],
    ["超出原文末尾", { endOffset: paragraphs[0].text.length + 1, selectedText: paragraphs[0].text + "假" }],
  ] satisfies [string, Partial<ReadingAnchorPart>][])("拒绝非法片段：%s", (_name, override) => {
    expect(verify([{ ...part("p1"), ...override }])).toBeNull();
  });

  it("UTF-16 偏移保留完整 emoji 与扩展汉字，不把 code point 数当偏移", () => {
    const selected = part("p4", 1, 5);
    expect(selected.selectedText).toBe("😀𠮷");
    expect(selected.endOffset - selected.startOffset).toBe(4);
    expect(verify([selected], { chapterId: "chapter-a" })).toEqual(selected);
    const parts = [part("p3", 2), part("p4", 0, 5)];
    expect(verify(parts)).toEqual({ ...parts[0], version: 2, fragments: parts });
  });
  it.each([[1, 2], [2, 3], [3, 4], [4, 5]])("拒绝截断代理对 [%i, %i)，即使切片字符串逐字匹配", (start, end) => {
    expect(verify([part("p4", start, end)], { chapterId: "chapter-a" })).toBeNull();
  });
});
