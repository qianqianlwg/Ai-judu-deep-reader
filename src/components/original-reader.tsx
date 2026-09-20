"use client";
import dynamic from "next/dynamic";
import type {CbzReaderProps} from "./cbz-reader";
import {originalReaderKind} from "./reader-mode";
const Cbz=dynamic(()=>import("./cbz-reader").then(module=>module.CbzReader),{ssr:false});
const Epub=dynamic(()=>import('./epub-reader').then(module=>module.EpubReader),{ssr:false});
const Pdf=dynamic(()=>import('./pdf-reader').then(module=>module.PdfReader),{ssr:false});
/** WHY：组合根按原件真实格式装配渲染器；PDF.js不进入EPUB加载/校验路径。 */
export function OriginalReader(props:CbzReaderProps){
 const kind=originalReaderKind(props.book);
 if(kind==='epub'||kind==='fb2')return <Epub {...props}/>;
 if(kind==='cbz')return <Cbz {...props}/>;
 if(kind==='pdf')return <Pdf {...props}/>;
 return <div role="alert">此版本没有可用原文件。<button onClick={props.onFallback}>切回精读</button></div>;
}
