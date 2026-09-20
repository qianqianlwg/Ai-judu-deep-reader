"use client";
import {useMemo,type RefObject} from 'react';
import {OriginalInteractionLayer} from './original-interaction-layer';
import {buildEpubInteractions} from '@/lib/epub-interactions';
import type {EpubParagraphMap} from '@/lib/epub-source-map';
import type {ConceptDetail,TextAnnotation} from '@/lib/annotations';
import {previewEpubLink,type EpubLinkPreview} from '@/lib/epub-link-preview';
import type {FoliateBook,FoliateView} from '@/lib/foliate-types';
export type EpubInteractionDocument={doc:Document;index:number;maps:EpubParagraphMap[]};
type Props={host:RefObject<HTMLDivElement|null>;documents:readonly EpubInteractionDocument[];view:FoliateView;book:FoliateBook;annotations:readonly TextAnnotation[];concepts:readonly ConceptDetail[];disabled?:boolean;onOpenAnnotation?:(annotation:TextAnnotation)=>void;onJump:(preview:EpubLinkPreview)=>Promise<void>;onNotice:(message:string)=>void};
export function EpubInteractionLayer(props:Props){
 const documents=useMemo(()=>props.documents.map(item=>({doc:item.doc,index:item.index,targets:buildEpubInteractions(item.maps,props.annotations,props.concepts)})),[props.documents,props.annotations,props.concepts]);
 const relocationSources=useMemo(()=>[props.view,...(props.view.renderer?[props.view.renderer]:[])],[props.view]);
 return <OriginalInteractionLayer {...props} documents={documents} documentsIdentity={props.documents} relocationSources={relocationSources} previewLink={(link,index,doc)=>previewEpubLink(link.getAttribute('href')??'',props.book.sections,index,doc,props.book)} interceptLink={link=>/noteref/u.test(link.getAttribute('epub:type')??link.getAttribute('role')??'')}/>;
}
