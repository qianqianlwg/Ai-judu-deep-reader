import {buildReaderInteractions} from './reader-interactions';
import {rangeForEpubAnchor,type EpubParagraphMap} from './epub-source-map';
import type {ConceptDetail,TextAnnotation} from './annotations';
export {epubPointToHost,epubRectToHost,insideRect,clipReaderRect} from './reader-interactions';
export type {ReaderInteraction as EpubInteraction,ReaderRect} from './reader-interactions';
export function buildEpubInteractions(maps:readonly EpubParagraphMap[],annotations:readonly TextAnnotation[],concepts:readonly ConceptDetail[]){
 return buildReaderInteractions(maps.map(map=>map.paragraph),(id,start,end)=>rangeForEpubAnchor(maps,id,start,end),annotations,concepts);
}
