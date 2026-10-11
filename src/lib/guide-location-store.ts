import { z } from "zod";
import { GuideError, type GuideNode } from "./guide";
import { guideHead, guideNodes, type GuideDb } from "./guide-store";
import { anchorParts, readReadingAnchor } from "./reading-anchors";
import { guideLocationsSchema, type GuideLocations, type GuideSourceLocation } from "./guide-locations";
const paragraphRows = z.array(z.object({ id: z.string(), editionId: z.string(), chapterId: z.string(), chapterTitle: z.string(), text: z.string() }));
const sourceRows = z.array(z.object({ sourceId: z.string(), editionId: z.string(), editionLabel: z.string(), anchorJson: z.string() }));
function collect(db: GuideDb, bookId: string, nodes: GuideNode[], version: number): GuideLocations {
  const requested = new Set(nodes.flatMap(node => node.sourceIds));
  if (!requested.size) return { bookId, version, sources: [], issues: [] };
  // WHY：DatabaseSync 在当前只读快照内同步核对来源及正文；位置长度沿用锚点的 UTF-16，不能混用 SQLite 的码点长度或屏幕页数。
  const paragraphs = paragraphRows.parse(db.prepare("SELECT p.id,e.id AS editionId,c.id AS chapterId,c.title AS chapterTitle,p.text FROM editions e JOIN chapters c ON c.edition_id=e.id JOIN paragraphs p ON p.chapter_id=c.id WHERE e.book_id=? ORDER BY e.id,c.order_index,c.id,p.order_index,p.id").all(bookId));
  const totals = new Map<string, number>();
  const indices = new Map<string, number>();
  const byParagraph = new Map<string, { row: typeof paragraphs[number]; offset: number; paragraphIndex: number }>();
  for (const row of paragraphs) {
    const offset = totals.get(row.editionId) ?? 0;
    const paragraphIndex = indices.get(row.editionId) ?? 0;
    byParagraph.set(row.id, { row, offset, paragraphIndex });
    indices.set(row.editionId, paragraphIndex + 1);
    totals.set(row.editionId, offset + row.text.length);
  }
  const candidates = sourceRows.parse(db.prepare("SELECT s.message_id AS sourceId,s.edition_id AS editionId,e.file_name AS editionLabel,s.anchor_json AS anchorJson FROM guide_sources s JOIN editions e ON e.id=s.edition_id AND e.book_id=s.book_id JOIN chat_messages m ON m.id=s.message_id AND m.status='completed' WHERE s.book_id=?").all(bookId));
  const sources: GuideSourceLocation[] = [];
  for (const candidate of candidates) {
    if (!requested.has(candidate.sourceId)) continue;
    const anchor = readReadingAnchor(JSON.parse(candidate.anchorJson));
    const total = totals.get(candidate.editionId) ?? 0;
    if (!anchor || !total) continue;
    const spans: GuideSourceLocation["spans"] = [];
    let verified = true;
    for (const part of anchorParts(anchor)) {
      const paragraph = byParagraph.get(part.paragraphId);
      if (!paragraph || paragraph.row.editionId !== candidate.editionId || part.endOffset > paragraph.row.text.length || paragraph.row.text.slice(part.startOffset, part.endOffset) !== part.selectedText) { verified = false; break; }
      spans.push({ paragraphId: part.paragraphId, paragraphIndex: paragraph.paragraphIndex, chapterId: paragraph.row.chapterId, chapterTitle: paragraph.row.chapterTitle, start: (paragraph.offset + part.startOffset) / total, end: (paragraph.offset + part.endOffset) / total });
    }
    // WHY：不合格锚点不生成推测位置；保留其他可靠来源，并向界面明确报告无法核对的依据。
    if (verified) sources.push({ sourceId: candidate.sourceId, editionId: candidate.editionId, editionLabel: candidate.editionLabel, spans });
  }
  const available = new Set(sources.map(source => source.sourceId));
  const missing = [...requested].filter(id => !available.has(id)).length;
  return guideLocationsSchema.parse({ bookId, version, sources, issues: missing ? [missing + " 则原文依据无法核对位置，未使用推测值。"] : [] });
}
export function readGuideLocations(db: GuideDb, bookId: string): GuideLocations {
  // WHY：版本、原文顺序与锚点在同一只读事务读取；导图自动更新时不能把不同修订的位置混在一起。
  db.exec("BEGIN");
  try {
    if (!db.prepare("SELECT id FROM books WHERE id=?").get(bookId)) throw new GuideError("这本书不存在", 404);
    const head = guideHead(db, bookId);
    const result = collect(db, bookId, guideNodes(db, head.current_revision), head.version);
    db.exec("COMMIT");
    return result;
  } catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
}
