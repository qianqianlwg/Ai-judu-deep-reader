import type { getDb } from "./db";
import { buildBookKnowledge } from "./knowledge-records";
import { anchorParts, joinAnchorText } from "./reading-anchors";
import { verifySelectionAnchors } from "./reading-anchor-validation";

export function readStoredBookKnowledge(db: Pick<ReturnType<typeof getDb>, "prepare">, editionId: string) {
    // WHY：全书范围由版本限定，绝不按当前会话过滤；LEFT JOIN 保留没有消息外键的旧标注。
    const annotations = db.prepare(
      `SELECT a.id, a.summary, a.concepts, a.concept_details, a.created_at,
        a.start_offset, a.end_offset, a.text_hash, a.message_id AS stored_message_id,
        p.id AS paragraph_id, p.text AS paragraph_text, c.id AS chapter_id, c.title AS chapter_title,
        c.edition_id, c.edition_id AS source_edition_id, t.id AS thread_id, m.id AS message_id
       FROM annotations a
       JOIN paragraphs p ON p.id = a.paragraph_id
       JOIN chapters c ON c.id = p.chapter_id
       LEFT JOIN reading_threads t ON t.id = a.thread_id AND t.edition_id = c.edition_id
       LEFT JOIN chat_messages m ON m.id = a.message_id AND m.thread_id = t.id
         AND m.role = 'assistant' AND m.status = 'completed'
       WHERE c.edition_id = ? ORDER BY a.created_at DESC, a.id`,
    ).all(editionId);
    const messages = db.prepare(
      `SELECT m.id, m.thread_id, m.role, m.status, m.structured_output, m.created_at, t.edition_id,
        source.paragraph_id, source.paragraph_text, source.chapter_id, source.chapter_title,
        source.source_edition_id
       FROM chat_messages m
       JOIN reading_threads t ON t.id = m.thread_id
       LEFT JOIN (
         SELECT p.id AS paragraph_id, p.text AS paragraph_text, c.id AS chapter_id,
           c.title AS chapter_title, c.edition_id AS source_edition_id
         FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE c.edition_id = ?
       ) source ON source.paragraph_id = CASE WHEN json_valid(m.structured_output)
         THEN json_extract(m.structured_output, '$.anchor.paragraphId') ELSE NULL END
       WHERE t.edition_id = ? AND m.role = 'assistant' AND m.status = 'completed'
         AND m.structured_output IS NOT NULL
       ORDER BY m.created_at DESC, m.id`,
    ).all(editionId, editionId);
    return buildBookKnowledge(editionId, annotations, messages, anchor => Boolean(verifySelectionAnchors(db, {
      editionId, bookId:null, chapterId:null, paragraphId:anchor.paragraphId, selectionStart:anchor.startOffset, selectionEnd:anchor.endOffset,
      selectedText:joinAnchorText(anchorParts(anchor)), selectionAnchors:[...anchorParts(anchor)],
    })));
}
