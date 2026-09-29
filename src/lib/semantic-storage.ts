import type { getDb } from './db';
import { createAnnotation } from './annotations';
import { anchorParts, joinAnchorText } from './reading-anchors';
import { verifySelectionAnchors } from './reading-anchor-validation';
import { MAX_SECTION_CHARACTERS, SEMANTIC_PROMPT_VERSION, type SemanticUnit } from './semantic-reading';
type Db=ReturnType<typeof getDb>;
export function resolveChapterSelection(db:Db,editionId:string,bookId:string|null,chapterId:string){
 const chapter=db.prepare('SELECT c.title, e.book_id, e.file_type FROM chapters c JOIN editions e ON e.id=c.edition_id WHERE c.id=? AND c.edition_id=?').get(chapterId,editionId) as {title:string;book_id:string;file_type:string}|undefined;
 if(!chapter||(bookId&&chapter.book_id!==bookId))throw new Error('本节不属于当前书籍版本');
 if(['.pdf','.cbz'].includes(chapter.file_type))throw new Error('当前格式没有可靠的本节结构，请选择文字后按句意细读。');
 const paragraphs=db.prepare('SELECT id,text FROM paragraphs WHERE chapter_id=? ORDER BY order_index,id').all(chapterId) as {id:string;text:string}[];
 if(!paragraphs.length||paragraphs.some(p=>!p.text.trim()))throw new Error('本节没有可连续核验的文字，请选择正文后句读。');
 if(paragraphs.length>256)throw new Error('本节超过256段，请选择较小范围；原文未截断。');
 const selectionAnchors=paragraphs.map(p=>({paragraphId:p.id,startOffset:0,endOffset:p.text.length,selectedText:p.text}));
 const selectedText=joinAnchorText(selectionAnchors);
 if(Array.from(selectedText).length>MAX_SECTION_CHARACTERS)throw new Error(`本节超过${MAX_SECTION_CHARACTERS}字符，请选择较小范围；原文未截断。`);
 return {chapterTitle:chapter.title,bookId:chapter.book_id,chapterId,paragraphId:selectionAnchors[0].paragraphId,selectionStart:0,selectionEnd:selectionAnchors[0].endOffset,selectionAnchors,selectedText};
}
export function commitSemanticUnit(db:Db,input:{threadId:string;editionId:string;bookId:string|null;parentId:string;attemptId:string;model:string},unit:SemanticUnit,saveParent:()=>void){
 if(unit.status!=='completed'||!unit.analysis||!unit.content.trim())throw new Error('未完成的语义块不能发布');
 const parts=[...anchorParts(unit.anchor)],first=parts[0];
 // WHY：事务内再次验证真实原文和父请求租约，子结果、标注及父进度必须一起提交，刷新后不靠页面补写。
 db.exec('BEGIN IMMEDIATE');
 try {
  const parent=db.prepare("SELECT id FROM chat_messages WHERE id=? AND thread_id=? AND status='streaming' AND json_extract(structured_output,'$._request.attemptId')=?").get(input.parentId,input.threadId,input.attemptId);
  if(!parent)throw new Error('本轮已结束或已被新的尝试替代');
  const valid=verifySelectionAnchors(db,{editionId:input.editionId,bookId:input.bookId,chapterId:null,paragraphId:first.paragraphId,selectionStart:first.startOffset,selectionEnd:first.endOffset,selectedText:joinAnchorText(parts),selectionAnchors:parts});
  if(!valid)throw new Error('句读块原文已变化，未发布结果');
  const existing=db.prepare('SELECT thread_id,structured_output FROM chat_messages WHERE id=?').get(unit.id) as {thread_id:string;structured_output:string}|undefined;
  if(existing&&(existing.thread_id!==input.threadId||JSON.parse(existing.structured_output)?._semanticParent!==input.parentId))throw new Error('句读块身份冲突');
  const now=new Date().toISOString();
  const stored={...unit.analysis,readingText:unit.content,anchor:valid,outputFormat:'text',_semanticParent:input.parentId};
  db.prepare("INSERT INTO chat_messages(id,thread_id,role,content,raw_content,structured_output,status,model_name,prompt_version,created_at,usage_json) VALUES(?,?,'assistant',?,?,?,'completed',?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,raw_content=excluded.raw_content,structured_output=excluded.structured_output,status='completed',usage_json=excluded.usage_json").run(unit.id,input.threadId,unit.content,unit.content,JSON.stringify(stored),input.model,SEMANTIC_PROMPT_VERSION,now,unit.usage?JSON.stringify(unit.usage):null);
  for(const part of parts){
   const row=db.prepare('SELECT text FROM paragraphs WHERE id=?').get(part.paragraphId) as {text:string};
   const a=createAnnotation({id:`semantic-${unit.id}-${part.paragraphId}-${part.startOffset}`,paragraphId:part.paragraphId,startOffset:part.startOffset,endOffset:part.endOffset,threadId:input.threadId,messageId:unit.id,summary:unit.analysis.summary.trim()||unit.content,concepts:unit.analysis.concepts.map(c=>c.name),conceptDetails:unit.analysis.concepts,createdAt:now},row.text);
   db.prepare('INSERT INTO annotations(id,paragraph_id,start_offset,end_offset,text_hash,thread_id,summary,concepts,created_at,concept_details,message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(a.id,a.paragraphId,a.startOffset,a.endOffset,a.textHash,a.threadId,a.summary,JSON.stringify(a.concepts),a.createdAt,JSON.stringify(a.conceptDetails??[]),unit.id);
  }
  saveParent();db.exec('COMMIT');
 }catch(error:unknown){db.exec('ROLLBACK');throw error;}
}
