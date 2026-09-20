"use client";
import {useMemo,type RefObject} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api';
import type {ConceptDetail,TextAnnotation} from '@/lib/annotations';
import {buildReaderInteractions} from '@/lib/reader-interactions';
import {pdfRangesForSource,type PdfDomPage,type PdfDocumentIndex} from '@/lib/pdf-source-map';
import {previewPdfReference} from '@/lib/pdf-reference-preview';
import {OriginalInteractionLayer} from './original-interaction-layer';
type Props={host:RefObject<HTMLDivElement|null>;book:object;document:PDFDocumentProxy;index:PdfDocumentIndex;pages:readonly PdfDomPage[];annotations:readonly TextAnnotation[];concepts:readonly ConceptDetail[];disabled?:boolean;onOpenAnnotation?:(annotation:TextAnnotation)=>void;onNotice:(message:string)=>void;onJump:(page:number)=>void};
export function PdfInteractionLayer(props:Props){
 const identity=useMemo(()=>({book:props.book,document:props.document,pages:props.pages}),[props.book,props.document,props.pages]);
 const documents=useMemo(()=>props.pages.map(page=>({doc:page.container.ownerDocument,index:page.pageNumber,scope:page.container.parentElement??page.container,targets:buildReaderInteractions(props.index.paragraphs.filter(p=>page.points.some(point=>point.paragraphId===p.id)),(id,start,end)=>pdfRangesForSource([page],{paragraphId:id,startOffset:start,endOffset:end})[0]??null,props.annotations,props.concepts).map(target=>({...target,key:'pdf:'+page.pageNumber+':'+target.key}))})),[props.pages,props.index,props.annotations,props.concepts]);
 return <OriginalInteractionLayer {...props} documents={documents} documentsIdentity={identity} previewLink={link=>previewPdfReference(link,props.document,props.index)} referenceUnavailableText="该引用目标无法在当前 PDF 中定位，原文件链接可能已失效；请使用页码导航。" interceptLink={()=>true} onJump={async preview=>{if(preview.index!==undefined)props.onJump(preview.index+1);}}/>;
}
