import { hashText } from "./hash";

export type ReadingMarkKind = "highlight" | "note" | "favorite";
export type ReadingMarkColor = "yellow" | "green" | "blue" | "pink" | "orange";
export type ReadingMarkAnchor = {
  paragraphId: string; startOffset: number; endOffset: number; selectedText: string; textHash: string;
};
export type ReadingMark = {
  id: string; editionId: string; kind: ReadingMarkKind; color: ReadingMarkColor; note: string;
  anchors: ReadingMarkAnchor[]; createdAt: string; updatedAt: string;
};
export type ReadingMarkInput = Omit<ReadingMark, "id" | "createdAt" | "updatedAt"> & { id?: string };
export const MAX_READING_NOTE_LENGTH = 10_000;
export const MAX_READING_MARK_ANCHORS = 256;
export const MAX_READING_MARK_TEXT_LENGTH = 200_000;
export type ReadingMarksDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown;
  };
};
export type ReadingMarksDependencies = { db: ReadingMarksDatabase; newId(): string; now(): string };
export class ReadingMarkError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 404 | 409 | 413 | 415 = 400) {
    super(message); this.name = "ReadingMarkError";
  }
}
const KINDS: readonly string[] = ["highlight", "note", "favorite"];
const COLORS: readonly string[] = ["yellow", "green", "blue", "pink", "orange"];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function bodyObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ReadingMarkError("invalid_input", "标注请求格式错误或包含未知字段");
  return value;
}
export function readingMarkId(value: unknown, label = "标注 ID"): string {
  if (typeof value !== "string" || /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u.exec(value)?.[0] !== value) {
    throw new ReadingMarkError("invalid_id", label + "不合法，请重新选择");
  }
  return value;
}
function parseAnchor(value: unknown): ReadingMarkAnchor {
  const body = bodyObject(value, ["paragraphId", "startOffset", "endOffset", "selectedText", "textHash"]);
  const { startOffset, endOffset, selectedText, textHash } = body;
  if (typeof startOffset !== "number" || typeof endOffset !== "number" || !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)
    || startOffset < 0 || endOffset <= startOffset) throw new ReadingMarkError("invalid_range", "选文范围不能为空，起止位置必须是有效 UTF-16 整数偏移");
  if (typeof selectedText !== "string" || !selectedText.trim() || selectedText.length !== endOffset - startOffset) {
    throw new ReadingMarkError("invalid_range", "选文不能为空，且字串长度必须与 UTF-16 起止位置一致，请重新划选");
  }
  if (typeof textHash !== "string" || /^[a-f0-9]{64}$/u.exec(textHash)?.[0] !== textHash) throw new ReadingMarkError("invalid_hash", "选文哈希必须是原样选文的 SHA-256 小写十六进制值");
  return { paragraphId: readingMarkId(body.paragraphId, "段落 ID"), startOffset, endOffset, selectedText, textHash };
}
export function parseReadingMarkInput(value: unknown): ReadingMarkInput {
  const body = bodyObject(value, ["id", "editionId", "kind", "color", "note", "anchors"]);
  if (typeof body.kind !== "string" || !KINDS.includes(body.kind)) throw new ReadingMarkError("invalid_kind", "标注类型需为 highlight、note 或 favorite");
  const color = body.color === undefined ? "yellow" : body.color, note = body.note === undefined ? "" : body.note;
  if (typeof color !== "string" || !COLORS.includes(color)) throw new ReadingMarkError("invalid_color", "请选择黄色、绿色、蓝色、粉色或橙色标注");
  if (typeof note !== "string" || note.length > MAX_READING_NOTE_LENGTH) throw new ReadingMarkError("invalid_note", "笔记需为文本，且不得超过 10000 个 UTF-16 字符");
  if (body.kind === "note" && !note.trim()) throw new ReadingMarkError("empty_note", "笔记内容不能为空，请填写内容或改用标亮/收藏");
  if (!Array.isArray(body.anchors) || body.anchors.length === 0 || body.anchors.length > MAX_READING_MARK_ANCHORS) {
    throw new ReadingMarkError("invalid_range", "请选择 1–256 个连续段落范围");
  }
  const anchors = body.anchors.map(parseAnchor);
  if (anchors.reduce((count, anchor) => count + anchor.selectedText.length, 0) > MAX_READING_MARK_TEXT_LENGTH) {
    throw new ReadingMarkError("range_too_large", "标注选文超过 200000 个 UTF-16 字符，请分段保存", 413);
  }
  if (new Set(anchors.map(anchor => anchor.paragraphId)).size !== anchors.length) throw new ReadingMarkError("invalid_range", "同一次标注不能包含重复段落，请提交连续选文");
  // WHY：手动标注可少于 10 字或超过 1000 字；句读的输入限制不适用于用户笔记和单词标亮。
  return { ...(body.id === undefined ? {} : { id: readingMarkId(body.id) }), editionId: readingMarkId(body.editionId, "书籍版本 ID"),
    kind: body.kind as ReadingMarkKind, color: color as ReadingMarkColor, note, anchors };
}
export function readingMarksEditionQuery(params: URLSearchParams): string {
  if ([...params.keys()].some(key => key !== "editionId") || params.getAll("editionId").length !== 1) throw new ReadingMarkError("invalid_query", "请提供唯一的 editionId，且不要附带其他查询字段");
  return readingMarkId(params.get("editionId"), "书籍版本 ID");
}
export function parseReadingMarkDelete(value: unknown): { id: string; editionId: string } {
  const body = bodyObject(value, ["id", "editionId"]);
  return { id: readingMarkId(body.id), editionId: readingMarkId(body.editionId, "书籍版本 ID") };
}
function ensureEdition(db: ReadingMarksDatabase, editionId: string): void {
  if (!db.prepare("SELECT id FROM editions WHERE id = ?").get(editionId)) throw new ReadingMarkError("edition_not_found", "书籍版本不存在，请刷新书架后重新选择", 404);
}
function splitsSurrogate(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}
function validateAnchors(db: ReadingMarksDatabase, input: ReadingMarkInput): void {
  const paragraph = db.prepare("SELECT p.text FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE p.id = ? AND c.edition_id = ?");
  for (const [index, anchor] of input.anchors.entries()) {
    const row = paragraph.get(anchor.paragraphId, input.editionId);
    if (!record(row) || typeof row.text !== "string") throw new ReadingMarkError("anchor_mismatch", "选文段落不属于此版本或已不存在，请在当前版本重新划选", 409);
    const text = row.text;
    if (anchor.endOffset > text.length || splitsSurrogate(text, anchor.startOffset) || splitsSurrogate(text, anchor.endOffset)) {
      throw new ReadingMarkError("anchor_mismatch", "选文位置已失效或截断了完整字符，请重新划选", 409);
    }
    // WHY：以数据库原始段落 slice 校验，不能 trim、规范化或相信客户端传来的原文/哈希。
    const original = text.slice(anchor.startOffset, anchor.endOffset);
    if (original !== anchor.selectedText || hashText(original) !== anchor.textHash) throw new ReadingMarkError("anchor_mismatch", "选文或哈希与原文不符，请刷新后重新划选；原文未被修改", 409);
    if (input.anchors.length > 1 && ((index > 0 && anchor.startOffset !== 0) || (index < input.anchors.length - 1 && anchor.endOffset !== text.length))) {
      throw new ReadingMarkError("non_contiguous_range", "多段标注必须包含首段尾部、中间完整段落和末段开头，不能跳过文字");
    }
  }
  if (input.anchors.length < 2) return;
  // WHY：只取排序索引，不加载整本原文；跨章节也按阅读顺序验证相邻段落，禁止拼接离散选文。
  const rows = db.prepare("SELECT p.id FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE c.edition_id = ? ORDER BY c.order_index, c.id, p.order_index, p.id").all(input.editionId);
  const order = rows.map(row => { if (!record(row) || typeof row.id !== "string") throw new Error("段落顺序数据损坏"); return row.id; });
  const first = order.indexOf(input.anchors[0].paragraphId);
  if (first < 0 || input.anchors.some((anchor, index) => order[first + index] !== anchor.paragraphId)) {
    throw new ReadingMarkError("non_contiguous_range", "多段标注必须按原书顺序连续选择，不能倒序或跳过段落");
  }
}
const SELECT_MARK = "SELECT id, edition_id AS editionId, kind, color, note, anchors_json AS anchorsJson, created_at AS createdAt, updated_at AS updatedAt FROM reading_marks";
function fromRow(value: unknown): ReadingMark {
  if (!record(value) || typeof value.anchorsJson !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
    || typeof value.color !== "string" || typeof value.note !== "string") throw new Error("标注存储数据损坏，请从备份恢复");
  try {
    const input = parseReadingMarkInput({ id: value.id, editionId: value.editionId, kind: value.kind, color: value.color, note: value.note, anchors: JSON.parse(value.anchorsJson) });
    return { ...input, id: readingMarkId(value.id), createdAt: value.createdAt, updatedAt: value.updatedAt };
  } catch (error: unknown) { throw new Error("标注存储数据无法读取，请从备份恢复", { cause: error }); }
}
function transaction<T>(db: ReadingMarksDatabase, operation: () => T): T {
  // WHY：SQLite 同步事务中完成归属、原文校验和写入；中间不 await，避免校验通过后原文被并发改动。
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error: unknown) {
    try { db.exec("ROLLBACK"); }
    catch (rollback: unknown) { throw new AggregateError([error, rollback], "标注保存及回滚均失败"); }
    throw error;
  }
}
export function createReadingMarksStore({ db, newId, now }: ReadingMarksDependencies) {
  const find = (id: string, editionId: string): ReadingMark => {
    const row = db.prepare(SELECT_MARK + " WHERE id = ? AND edition_id = ?").get(id, editionId);
    // WHY：不存在与跨版本使用同一错误，不能借全局标注 ID 读取或覆盖其他版本的私人笔记。
    if (!row) throw new ReadingMarkError("mark_not_found", "当前版本中未找到该标注，可能已删除，请刷新列表", 404);
    return fromRow(row);
  };
  return {
    list(editionValue: unknown): ReadingMark[] {
      const editionId = readingMarkId(editionValue, "书籍版本 ID"); ensureEdition(db, editionId);
      return db.prepare(SELECT_MARK + " WHERE edition_id = ? ORDER BY updated_at DESC, id").all(editionId).map(fromRow);
    },
    save(value: unknown): { mark: ReadingMark; created: boolean } {
      const input = parseReadingMarkInput(value);
      return transaction(db, () => {
        ensureEdition(db, input.editionId);
        const existing = input.id === undefined ? undefined : find(input.id, input.editionId);
        validateAnchors(db, input);
        const time = now(), id = existing?.id ?? newId();
        const mark: ReadingMark = { ...input, id, createdAt: existing?.createdAt ?? time, updatedAt: time };
        if (existing) db.prepare("UPDATE reading_marks SET kind = ?, color = ?, note = ?, anchors_json = ?, updated_at = ? WHERE id = ? AND edition_id = ?")
          .run(mark.kind, mark.color, mark.note, JSON.stringify(mark.anchors), mark.updatedAt, mark.id, mark.editionId);
        else db.prepare("INSERT INTO reading_marks (id, edition_id, kind, color, note, anchors_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(mark.id, mark.editionId, mark.kind, mark.color, mark.note, JSON.stringify(mark.anchors), mark.createdAt, mark.updatedAt);
        return { mark, created: !existing };
      });
    },
    remove(value: unknown): { id: string; editionId: string; deleted: true } {
      const input = parseReadingMarkDelete(value);
      return transaction(db, () => {
        ensureEdition(db, input.editionId); find(input.id, input.editionId);
        db.prepare("DELETE FROM reading_marks WHERE id = ? AND edition_id = ?").run(input.id, input.editionId);
        return { ...input, deleted: true };
      });
    },
  };
}
