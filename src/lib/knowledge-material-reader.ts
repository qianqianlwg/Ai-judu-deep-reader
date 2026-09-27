import type { getDb } from "./db";
import { makeReadingAnchor, readAnchorParts, joinAnchorText, splitsReadingCharacter } from "./reading-anchors";
import { verifySelectionAnchors } from "./reading-anchor-validation";
import { readStoredBookKnowledge } from "./knowledge-reader";
import type { KnowledgeMaterial, KnowledgeSource, MaterialQuery, MaterialsResponse } from "./knowledge-materials";
type Database = ReturnType<typeof getDb>;
type EditionRow = KnowledgeSource;
type ParagraphRow = {id:string;chapterId:string;chapterTitle:string;text:string};
type MarkRow = {id:string;kind:"highlight"|"note"|"favorite";note:string;anchorsJson:string;updatedAt:string};
const LABELS = {highlight:"标亮",note:"笔记",favorite:"收藏"};
function editions(db:Database,scope:"current"|"all",editionId:string|null):EditionRow[]{
  return db.prepare(`SELECT e.id AS editionId,e.book_id AS bookId,b.title AS bookTitle,b.author,
    e.file_name AS fileName,e.file_type AS fileType,e.created_at AS createdAt,
    (SELECT COUNT(*) FROM paragraphs p JOIN chapters pc ON pc.id=p.chapter_id WHERE pc.edition_id=e.id) AS paragraphCount
    FROM editions e JOIN books b ON b.id=e.book_id WHERE (?='all' OR e.id=?) ORDER BY e.created_at DESC,e.id`).all(scope,editionId) as EditionRow[];
}
function terms(query:string):string[]{return [...new Set(query.toLocaleLowerCase().split(/\s+/u).filter(Boolean))];}
function matches(query:string,values:readonly string[]):boolean{
  const haystack=values.join(" ").toLocaleLowerCase();
  return terms(query).every(term=>haystack.includes(term));
}
function paragraphs(db:Database,editionId:string):ParagraphRow[]{
  return db.prepare(`SELECT p.id,p.text,c.id AS chapterId,c.title AS chapterTitle
    FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE c.edition_id=?
    ORDER BY c.order_index,c.id,p.order_index,p.id`).all(editionId) as ParagraphRow[];
}
function sourceItem(edition:EditionRow):KnowledgeMaterial{
  return {id:"source:"+edition.editionId,kind:"source",origin:"original",title:edition.bookTitle,
    body:`已收录 ${edition.paragraphCount} 段正文 · ${edition.fileName}`,quote:"",
    createdAt:edition.createdAt,source:edition,chapterTitle:null,anchor:null,locationReason:null,concepts:[],conversation:null};
}
function originalItems(rows:ParagraphRow[],edition:EditionRow,query:string):KnowledgeMaterial[]{
  const items:KnowledgeMaterial[]=[];
  if(matches(query,[edition.bookTitle,edition.author,edition.fileName]))items.push(sourceItem(edition));
  if(!query)return items;
  for(const row of rows){
    // WHY：原书命中必须来自原文字面匹配；书名或 Unicode 归一化命中不制造虚假的 UTF-16 偏移。
    if(!matches(query,[row.text]))continue;
    const lower=row.text.toLocaleLowerCase(),found=lower.indexOf(terms(query)[0]);
    if(found<0||splitsReadingCharacter(row.text,found)||splitsReadingCharacter(row.text,found+terms(query)[0].length))continue;
    const start=found,end=found+terms(query)[0].length,selectedText=row.text.slice(start,end);
    const from=Math.max(0,start-80),to=Math.min(row.text.length,end+120);
    items.push({id:"passage:"+row.id,kind:"passage",origin:"original",title:row.chapterTitle,
      body:`${from?"…":""}${row.text.slice(from,to)}${to<row.text.length?"…":""}`,quote:selectedText,
      createdAt:edition.createdAt,source:edition,chapterTitle:row.chapterTitle,
      anchor:{editionId:edition.editionId,chapterId:row.chapterId,...makeReadingAnchor([{paragraphId:row.id,startOffset:start,endOffset:end,selectedText}])},
      locationReason:null,concepts:[],conversation:null});
  }
  return items;
}
function personalItems(db:Database,edition:EditionRow,query:string,warnings:string[]):KnowledgeMaterial[]{
  const marks=db.prepare(`SELECT id,kind,note,anchors_json AS anchorsJson,updated_at AS updatedAt
    FROM reading_marks WHERE edition_id=? ORDER BY updated_at DESC,id`).all(edition.editionId) as MarkRow[];
  const lookup=db.prepare(`SELECT p.id,p.text,c.id AS chapterId,c.title AS chapterTitle
    FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE p.id=? AND c.edition_id=?`);
  return marks.flatMap(row=>{
    let raw:unknown;
    try{raw=JSON.parse(row.anchorsJson) as unknown;}
    catch(error:unknown){console.warn("知识库标注锚点损坏",{id:row.id,error});warnings.push("部分旧标注的来源损坏，仍可查看文字");raw=null;}
    const parts=readAnchorParts(raw)??[];
    const first=parts[0],paragraph=first?lookup.get(first.paragraphId,edition.editionId) as ParagraphRow|undefined:undefined;
    const anchor=first&&paragraph?verifySelectionAnchors(db,{editionId:edition.editionId,bookId:edition.bookId,chapterId:paragraph.chapterId,
      paragraphId:first.paragraphId,selectionStart:first.startOffset,selectionEnd:first.endOffset,
      selectedText:joinAnchorText(parts),selectionAnchors:parts}):null;
    const quote=parts.length?parts.map(part=>typeof part.selectedText==="string"?part.selectedText:"").join("\n\n"):"";
    const title=row.note.trim()?"我的笔记":LABELS[row.kind];
    if(!matches(query,[title,row.note,quote,paragraph?.chapterTitle??"",edition.bookTitle]))return [];
    return [{id:"excerpt:"+row.id,kind:"excerpt",origin:"user",title,body:row.note||quote,quote,
      createdAt:row.updatedAt,source:edition,chapterTitle:paragraph?.chapterTitle??null,
      anchor:anchor?{editionId:edition.editionId,chapterId:paragraph!.chapterId,...anchor}:null,
      locationReason:anchor?null:"来源待核对，暂不支持原文跳转",concepts:[],conversation:null} satisfies KnowledgeMaterial];
  });
}
function aiItems(db:Database,edition:EditionRow,query:string):KnowledgeMaterial[]{
  return readStoredBookKnowledge(db,edition.editionId).records.filter(record=>matches(query,[record.summary,record.excerpt,record.chapterTitle??"",edition.bookTitle,...record.concepts.flatMap(concept=>[concept.name,concept.text])]))
    .map(record=>({id:record.id,kind:"understanding",origin:"ai",title:"句读解释",body:record.summary,quote:record.excerpt,
      createdAt:record.createdAt,source:edition,chapterTitle:record.chapterTitle,anchor:record.anchor,
      locationReason:record.locationReason,concepts:record.concepts,
      conversation:record.threadId?{threadId:record.threadId,messageId:record.messageId}:null}));
}
export function readKnowledgeMaterials(db:Database,query:MaterialQuery):MaterialsResponse{
  const allEditions=editions(db,query.scope,query.editionId),items:KnowledgeMaterial[]=[],warnings:string[]=[];
  for(const edition of allEditions){
    // WHY：空查询只展示资料/笔记/句读，不读取整本原文；原文扫描仅在用户确实输入关键词后进行。
    const rows=query.query?paragraphs(db,edition.editionId):[];
    items.push(...originalItems(rows,edition,query.query));
    items.push(...personalItems(db,edition,query.query,warnings));
    items.push(...aiItems(db,edition,query.query));
  }
  // WHY：仅只读投影，不迁移原消息/标注；跨书排序稳定，原书与句读同一查询可区分来源。
  const filtered=items.filter(item=>query.kind==="all"||item.kind===query.kind||(query.kind==="source"&&item.kind==="passage"));
  filtered.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  const counts={source:items.filter(item=>item.kind==="source"||item.kind==="passage").length,
    excerpt:items.filter(item=>item.kind==="excerpt").length,understanding:items.filter(item=>item.kind==="understanding").length,
    passage:items.filter(item=>item.kind==="passage").length};
  return {version:1,scope:query.scope,editionId:query.scope==="current"?query.editionId:null,query:query.query,
    items:filtered.slice(query.offset,query.offset+query.limit),counts,total:filtered.length,offset:query.offset,limit:query.limit,warnings:[...new Set(warnings)]};
}
