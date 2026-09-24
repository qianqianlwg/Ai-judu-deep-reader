import type { getDb } from "../db";
import { sourceIdForParagraph } from "../citation-validation";
import type { BookSource } from "./tools";
import type { ReadSourceInput } from "./schemas";

type Db = ReturnType<typeof getDb>;
type Row = { id: string; text: string; chapter_id: string; chapter_title: string; order_index: number };
const SELECT = "SELECT p.id,p.text,p.chapter_id,p.order_index,c.title AS chapter_title FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id";
export function createBookSources(db: Db, editionId: string) {
  const registered = new Map<string, BookSource>();
  const source = (row: Row): BookSource => ({ sourceId: sourceIdForParagraph(editionId, row.id), paragraphId: row.id, chapterId: row.chapter_id, chapterTitle: row.chapter_title, text: row.text.slice(0, 12000) });
  const neighbors = (row: Row, distance: number): BookSource[] => {
    const rows = db.prepare(SELECT + " WHERE c.edition_id=? AND p.chapter_id=? AND p.order_index BETWEEN ? AND ? ORDER BY p.order_index").all(editionId, row.chapter_id, row.order_index - distance, row.order_index + distance) as Row[];
    return rows.map(source);
  };
  return {
    registered,
    initial(paragraphId: string | null, selectionStart = 0): BookSource[] {
      if (!paragraphId) return [];
      const row = db.prepare(SELECT + " WHERE c.edition_id=? AND p.id=?").get(editionId, paragraphId) as Row | undefined;
      const sources = row ? neighbors(row, 1).map(item => item.paragraphId === paragraphId ? { ...item, text: row.text.slice(Math.max(0, selectionStart - 1500), Math.max(0, selectionStart - 1500) + 12000) } : item) : [];
      for (const item of sources) registered.set(item.sourceId, item);
      return sources;
    },
    async read(input: ReadSourceInput): Promise<BookSource[]> {
      const known = registered.get(input.sourceId);
      if (!known) throw new Error("未登记来源");
      const row = db.prepare(SELECT + " WHERE c.edition_id=? AND p.id=?").get(editionId, known.paragraphId) as Row | undefined;
      return row ? neighbors(row, input.neighbors).map(item => item.paragraphId === known.paragraphId ? { ...item, text: known.text } : item) : [];
    },
  };
}
