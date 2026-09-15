import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { READING_MARKS_SCHEMA } from "./db";
import { hashText } from "./hash";
import { createReadingMarksStore, parseReadingMarkInput, ReadingMarkError, type ReadingMarkAnchor, type ReadingMarksDatabase } from "./reading-marks";

type Db = ReadingMarksDatabase & { close(): void };
const sqlite = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
const TEXT = { p1: "甲😀乙  \n", p2: "中段概念\n保留换行", p3: "末段原文", big: "长".repeat(1501), foreign: "甲😀乙  \n" };
const schema = READING_MARKS_SCHEMA + "; CREATE TABLE editions (id TEXT PRIMARY KEY); CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, order_index INTEGER); CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, text_hash TEXT, order_index INTEGER); CREATE TABLE annotations (id TEXT PRIMARY KEY, summary TEXT); CREATE TABLE analyses (id TEXT PRIMARY KEY, result_json TEXT);";
let db: Db, store: ReturnType<typeof createReadingMarksStore>, nextId = 0, tick = 0;
function seed(target: Db) {
  target.exec(schema);
  target.exec("INSERT INTO editions VALUES ('e1'),('e2'); INSERT INTO chapters VALUES ('c1','e1',0),('c2','e1',1),('c3','e1',2),('foreign-c','e2',0); INSERT INTO annotations VALUES ('ai-history','AI历史原样'); INSERT INTO analyses VALUES ('ai-result','{}');");
  for (const [id, text] of Object.entries(TEXT)) {
    const chapter = id === "foreign" ? "foreign-c" : id === "p3" ? "c2" : id === "big" ? "c3" : "c1";
    target.prepare("INSERT INTO paragraphs VALUES (?,?,?,?,?)").run(id, chapter, text, hashText(text), id === "p2" ? 1 : 0);
  }
}
function anchor(paragraphId: keyof typeof TEXT = "p1", startOffset = 0, endOffset = TEXT[paragraphId].length): ReadingMarkAnchor {
  const selectedText = TEXT[paragraphId].slice(startOffset, endOffset);
  return { paragraphId, startOffset, endOffset, selectedText, textHash: hashText(selectedText) };
}
const input = (overrides: Record<string, unknown> = {}) => ({ editionId: "e1", kind: "highlight", anchors: [anchor()], ...overrides });
const save = (overrides: Record<string, unknown> = {}) => store.save(input(overrides));
beforeEach(() => {
  // WHY：同步 SQLite 仅用于真实事务测试；所有数据在内存或明确的临时目录，不触及用户主库。
  db = new sqlite.DatabaseSync(":memory:"); seed(db); nextId = 0; tick = 0;
  store = createReadingMarksStore({ db, newId: () => "mark-" + ++nextId, now: () => "2026-01-01T00:00:" + String(tick++).padStart(2, "0") + ".000Z" });
});
afterEach(() => db.close());

describe("独立手动阅读标注", () => {
  it("默认黄色和空备注，单字标亮与超过1000字选文均合法", () => {
    expect(save({ anchors: [anchor("p1", 0, 1)] })).toMatchObject({ created: true, mark: { color: "yellow", note: "", kind: "highlight" } });
    expect(save({ anchors: [anchor("big")] }).mark.anchors[0].selectedText.length).toBe(1501);
    expect(store.list("e1")).toHaveLength(2);
  });
  it("同一选文可保存多个标亮、笔记和收藏，不去重覆盖", () => {
    const marks = [save().mark, save({ kind: "favorite" }).mark, save({ kind: "note", note: "自己的理解" }).mark, save().mark];
    expect(new Set(marks.map(mark => mark.id)).size).toBe(4);
    expect(store.list("e1")).toHaveLength(4);
    expect(db.prepare("SELECT * FROM annotations").all()).toEqual([{ id: "ai-history", summary: "AI历史原样" }]);
    expect(db.prepare("SELECT * FROM analyses").all()).toEqual([{ id: "ai-result", result_json: "{}" }]);
  });
  it("更新保留 id/createdAt，并只改变对应标注", () => {
    const first = save().mark, other = save().mark;
    const result = save({ id: first.id, kind: "note", color: "pink", note: "新想法", anchors: [anchor("p1", 1, 3)] });
    expect(result.created).toBe(false);
    expect(result.mark).toMatchObject({ id: first.id, createdAt: first.createdAt, color: "pink", note: "新想法" });
    expect(result.mark.updatedAt).not.toBe(first.updatedAt);
    expect(store.list("e1").find(mark => mark.id === other.id)).toEqual(other);
  });
  it("所有颜色可保存；用户笔记按纯文本原样保留", () => {
    for (const color of ["yellow", "green", "blue", "pink", "orange"]) expect(save({ color }).mark.color).toBe(color);
    const note = "  解释\n<script>不是代码</script>  ";
    expect(save({ kind: "note", note }).mark.note).toBe(note);
  });
  it("连续多段含跨章节按原顺序保存，不修改原始段落", () => {
    const before = db.prepare("SELECT * FROM paragraphs ORDER BY id").all();
    const anchors = [anchor("p1", 3), anchor("p2"), anchor("p3", 0, 2)];
    expect(save({ kind: "favorite", anchors }).mark.anchors).toEqual(anchors);
    expect(db.prepare("SELECT * FROM paragraphs ORDER BY id").all()).toEqual(before);
  });
  it("UTF-16 按 emoji 两码元定位，保留选文首尾空白和换行", () => {
    expect(save({ anchors: [anchor("p1", 1, 3)] }).mark.anchors[0].selectedText).toBe("😀");
    const exact = anchor("p1", 3);
    expect(save({ anchors: [exact] }).mark.anchors[0]).toEqual(exact);
  });
  it.each([[1, 2], [2, 3]])("拒绝截断代理对 %s:%s", (start, end) => {
    expect(() => save({ anchors: [anchor("p1", start, end)] })).toThrowError(/完整字符/);
    expect(store.list("e1")).toEqual([]);
  });
  it("拒绝假选文、假hash与过期偏移，不以客户端文字覆盖原文", () => {
    const original = anchor("p1", 0, 1);
    for (const fake of [{ ...original, selectedText: "丙", textHash: hashText("丙") }, { ...original, textHash: "0".repeat(64) },
      { ...original, startOffset: 90, endOffset: 91 }]) expect(() => save({ anchors: [fake] })).toThrowError(ReadingMarkError);
    expect(db.prepare("SELECT text FROM paragraphs WHERE id='p1'").get()).toEqual({ text: TEXT.p1 });
    expect(store.list("e1")).toEqual([]);
  });
  it("读取原始段落而不是信任客户端或库内冗余hash", () => {
    db.prepare("UPDATE paragraphs SET text_hash='outdated' WHERE id='p1'").run();
    expect(save().created).toBe(true);
    db.prepare("UPDATE paragraphs SET text='旧位置已变化' WHERE id='p1'").run();
    expect(() => save()).toThrowError(/不符|失效/);
  });
  it("拒绝跳段、倒序、段间留洞、重复段落", () => {
    const cases = [[anchor("p1"), anchor("p3")], [anchor("p2"), anchor("p1")],
      [anchor("p1", 0, 1), anchor("p2")], [anchor("p1"), anchor("p2", 1)],
      [anchor("p1"), anchor("p2", 0, 1), anchor("p3")], [anchor("p1"), anchor("p1")]];
    for (const anchors of cases) expect(() => save({ anchors })).toThrowError(ReadingMarkError);
    expect(store.list("e1")).toEqual([]);
  });
  it("跨版本原文即使内容相同也不能标注；跨版本读改删不可泄露笔记", () => {
    const privateMark = save({ kind: "note", note: "只属于版本一的笔记" }).mark;
    expect(store.list("e2")).toEqual([]);
    expect(() => save({ anchors: [anchor("foreign")] })).toThrowError(/此版本/);
    expect(() => save({ anchors: [anchor("p1"), anchor("foreign")] })).toThrowError(/此版本/);
    expect(() => save({ id: privateMark.id, editionId: "e2", anchors: [anchor("foreign")] })).toThrowError(/当前版本中未找到/);
    expect(() => store.remove({ id: privateMark.id, editionId: "e2" })).toThrowError(/当前版本中未找到/);
    expect(store.list("e1")).toEqual([privateMark]);
  });
  it("删除只移除当前版本指定id，不删除同选文的其他标注或AI历史", () => {
    const first = save().mark, second = save().mark;
    expect(store.remove({ id: first.id, editionId: "e1" })).toEqual({ id: first.id, editionId: "e1", deleted: true });
    expect(store.list("e1")).toEqual([second]);
    expect(() => store.remove({ id: first.id, editionId: "e1" })).toThrowError(/未找到/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM annotations").get()).toEqual({ count: 1 });
  });
  it("新建不能指定不存在的id充当覆盖；版本不存在返回404", () => {
    for (const call of [() => save({ id: "missing" }), () => save({ editionId: "missing" }), () => store.list("missing")]) {
      expect(call).toThrowError(ReadingMarkError);
      try { call(); } catch (error: unknown) { expect(error).toMatchObject({ status: 404 }); }
    }
  });
  it("任何锚点失效均整体回滚，更新失败保留之前笔记", () => {
    const original = save({ kind: "note", note: "不能丢失" }).mark;
    expect(() => save({ id: original.id, note: "错误更新", anchors: [anchor("p1"), { ...anchor("p2"), textHash: "f".repeat(64) }] })).toThrow();
    expect(store.list("e1")).toEqual([original]);
    expect(save().created).toBe(true);
  });
  it("存储异常上抛并释放事务，之后仍可正常保存", () => {
    db.exec("CREATE TRIGGER reject_mark BEFORE INSERT ON reading_marks BEGIN SELECT RAISE(FAIL, 'disk simulation'); END;");
    expect(() => save()).toThrow(/disk simulation/); expect(store.list("e1")).toEqual([]);
    db.exec("DROP TRIGGER reject_mark"); expect(save().created).toBe(true);
  });
  it("损坏存储报错而不静默丢弃标注", () => {
    const mark = save().mark;
    db.prepare("UPDATE reading_marks SET anchors_json='[{}]' WHERE id=?").run(mark.id);
    expect(() => store.list("e1")).toThrowError(/无法读取/);
  });
  it("真实磁盘关闭重开后，笔记与锚点完整保留", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "judu-reading-marks-"));
    const file = path.join(directory, "marks.sqlite"); let connection: Db | undefined;
    try {
      connection = new sqlite.DatabaseSync(file); seed(connection);
      const writer = createReadingMarksStore({ db: connection, newId: () => "persisted", now: () => "2026-01-01T00:00:00.000Z" });
      const mark = writer.save(input({ kind: "note", note: "关机后仍在", anchors: [anchor("p1"), anchor("p2")] })).mark;
      connection.close(); connection = new sqlite.DatabaseSync(file);
      const reader = createReadingMarksStore({ db: connection, newId: () => "unused", now: () => "unused" });
      expect(reader.list("e1")).toEqual([mark]); expect(reader.list("e2")).toEqual([]);
    } finally {
      connection?.close();
      if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("judu-reading-marks-")) throw new Error("拒绝清理非测试目录");
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("标注边界输入", () => {
  it.each([null, [], {}, { editionId: "e1", kind: "unknown", anchors: [anchor()] }, input({ color: "red" }), input({ color: null }),
    input({ note: null }), input({ note: 1 }), input({ anchors: [] }), input({ anchors: null }), input({ kind: "note", note: " \n\t" }),
    input({ id: "' OR 1=1" }), input({ createdAt: "forged" }), input({ editionId: "e1\n" })])("拒绝非法对象 %#", value => {
    expect(() => parseReadingMarkInput(value)).toThrowError(ReadingMarkError);
  });
  it.each([{ startOffset: -1 }, { startOffset: 0.5 }, { endOffset: 0 }, { endOffset: Infinity }, { endOffset: Number.MAX_SAFE_INTEGER + 1 },
    { selectedText: "" }, { selectedText: "wrong-length" }, { textHash: "bad" }, { textHash: "a".repeat(64) + "\n" }, { editionId: "e2" }])("拒绝无效锚点 %#", change => {
    expect(() => save({ anchors: [{ ...anchor(), ...change }] })).toThrowError(ReadingMarkError);
  });
  it("明确限制超大笔记与请求范围；不截断内容", () => {
    expect(save({ kind: "note", note: "字".repeat(10000) }).mark.note.length).toBe(10000);
    expect(() => save({ kind: "note", note: "字".repeat(10001) })).toThrowError(/10000/);
    expect(() => save({ anchors: Array.from({ length: 257 }, () => anchor()) })).toThrowError(/256/);
    const selectedText = "长".repeat(200001);
    expect(() => save({ anchors: [{ paragraphId: "p1", startOffset: 0, endOffset: selectedText.length, selectedText, textHash: hashText(selectedText) }] })).toThrowError(/200000/);
  });
});
