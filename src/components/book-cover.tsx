"use client";
/* eslint-disable @next/next/no-img-element -- WHY：同源封面接口已输出有界缓存 WebP，不再经图片优化器重复转码。 */
import {useState} from "react";
import type {LibraryBook} from "@/lib/library";
import {coverTone,formatName,shelfTitle} from "./bookshelf-model";
export function BookCover({book,editionId}:{book:LibraryBook;editionId?:string}) {
  const edition=book.editions?.find(e=>e.id===editionId) ?? book.editions?.[0];
  const supported=edition?.hasOriginalFile && ["EPUB","PDF"].includes(formatName(edition.fileType));
  const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);
  return <span className={"bookshelf-cover cover-tone-"+coverTone(book.id)} aria-hidden="true">
    {!loaded&&<><span>{shelfTitle(book)}</span><small>{book.author||"作者未注明"}</small></>}
    {supported&&!failed&&<img className={"bookshelf-cover-image"+(loaded?" is-loaded":"")} src={"/api/books/"+encodeURIComponent(book.id)+"/cover?editionId="+encodeURIComponent(edition.id)} alt="" loading="lazy" decoding="async" onLoad={()=>setLoaded(true)} onError={()=>{setFailed(true);console.warn("封面不可用，保留文字封面",book.id,edition.id);}}/>}
    {failed&&<small className="bookshelf-cover-fallback">文字封面</small>}
  </span>;
}
