// @ts-check
import {indexMobiSourceHtml} from './mobi-source-html.mjs';
import {createHash} from 'node:crypto';
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutSnapshot} Snapshot */
/**
 * 只在可终止worker或后续实际使用边界调用；IPC shape decoder本身不承担HTML语义证明。
 * WHY：来源构建正确不等于随包文档没被后处理改变；交付前逐节点核验文档hash、节点与字符边界。
 * @param {Snapshot} snapshot
 */
export function verifyMobiLayoutTargets(snapshot){
 const chapters=new Map(snapshot.chapters.map(chapter=>[chapter.id,chapter]));
 /** @type {Map<string,{hash:string;index:ReturnType<typeof indexMobiSourceHtml>}>} */const indices=new Map();
 for(const reference of [...snapshot.toc,...snapshot.links]){
  const target=reference.target;if(!target)continue;
  const chapter=chapters.get(target.chapterId);if(!chapter)throw new Error('MOBI目标章节不存在');
  let entry=indices.get(chapter.id);if(!entry){entry={hash:createHash('sha256').update(chapter.html).digest('hex'),index:indexMobiSourceHtml(chapter.html,'body-fragment')};indices.set(chapter.id,entry);}
  if(target.htmlHash!==entry.hash||!(target.point.kind==='text'?entry.index.matchesTextDigest(target.point):entry.index.matches(target.point)))throw new Error('MOBI目标与正文节点不一致');
 }
}
