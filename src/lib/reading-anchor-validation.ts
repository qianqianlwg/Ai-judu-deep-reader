import type { getDb } from "./db";
import { makeReadingAnchor, readAnchorPart, splitsReadingCharacter, joinAnchorText, type ReadingAnchor, type ReadingAnchorPart } from "./reading-anchors";
type Db = Pick<ReturnType<typeof getDb>, "prepare">;
export function verifySelectionAnchors(db: Db, input: {editionId:string; bookId:string|null; chapterId:string|null; paragraphId:string|null; selectionStart:number|null; selectionEnd:number|null; selectedText:string; selectionAnchors:ReadingAnchorPart[]}): ReadingAnchor | null {
  const parts=input.selectionAnchors, first=parts[0];
  if (!first || input.paragraphId!==first.paragraphId || input.selectionStart!==first.startOffset || input.selectionEnd!==first.endOffset || joinAnchorText(parts)!==input.selectedText) return null;
  const query=db.prepare("SELECT p.text, p.chapter_id, e.book_id FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id JOIN editions e ON e.id=c.edition_id WHERE p.id=? AND c.edition_id=?");
  for(const [index,part] of parts.entries()) {
    const row=query.get(part.paragraphId,input.editionId) as {text:string;chapter_id:string;book_id:string}|undefined;
    if(!readAnchorPart(part)||!row||(input.bookId&&input.bookId!==row.book_id)||(index===0&&input.chapterId&&input.chapterId!==row.chapter_id)
      ||part.endOffset>row.text.length||splitsReadingCharacter(row.text,part.startOffset)||splitsReadingCharacter(row.text,part.endOffset)
      ||row.text.slice(part.startOffset,part.endOffset)!==part.selectedText||(index>0&&part.startOffset!==0)||(index<parts.length-1&&part.endOffset!==row.text.length))return null;
  }
  // WHY：只读取排序索引，避免每次划选把整本原文读入内存；版本和逐段原文已在上面核验。
  if(parts.length>1){
    const rows=db.prepare("SELECT p.id FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE c.edition_id=? ORDER BY c.order_index,c.id,p.order_index,p.id").all(input.editionId) as {id:string}[];
    const firstIndex=rows.findIndex(row=>row.id===first.paragraphId);
    if(firstIndex<0||parts.some((part,index)=>rows[firstIndex+index]?.id!==part.paragraphId))return null;
  }
  return makeReadingAnchor(parts);
}
