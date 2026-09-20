"use client";
import {useState} from 'react';
import type {LibraryBookContent} from '@/lib/library';
import {isCbzFormat} from '@/lib/cbz-manifest';
export type ImageChapterRequest={editionId:string;originalHash:string;sourceHref:string;sequence:number};
export function useImageChapters(book:LibraryBookContent){
 const [state,setState]=useState<{book:LibraryBookContent;chapterId:string;request:ImageChapterRequest|null}|null>(null);
 const imageOnly=isCbzFormat(book.edition?.fileType??''),active=imageOnly&&state?.book===book?state:null,chapter=book.chapters.find(chapter=>chapter.id===active?.chapterId)??book.chapters[0];
 const open=(id:string)=>{if(!imageOnly||!book.editionId)return false;const chapter=book.chapters.find(chapter=>chapter.id===id);if(!chapter?.sourceHref)return false;setState(previous=>({book,chapterId:id,request:{editionId:book.editionId!,originalHash:book.edition?.originalHash??'',sourceHref:chapter.sourceHref!,sequence:(previous?.request?.sequence??0)+1}}));return true;};
 const onPage=(page:number)=>{const chapter=book.chapters[page-1];if(!imageOnly||!chapter)return;setState(previous=>previous?.book===book&&previous.chapterId===chapter.id?previous:{book,chapterId:chapter.id,request:previous?.book===book?previous.request:null});};
 return {imageOnly,chapter:imageOnly?chapter:undefined,request:active?.request??null,open,onPage};
}
