// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { originalEpubAvailable, originalReaderKind, ReaderFormatStatus, useReaderMode } from './reader-mode';
import type { LibraryBookContent } from '@/lib/library';
const book:LibraryBookContent={id:'b',title:'书',author:'作者',editionId:'e',edition:{id:'e',fileName:'书.epub',fileType:'.epub',createdAt:'now',hasOriginalFile:true},chapters:[{id:'c',title:'正文',sourceHref:'OEBPS/c.xhtml',paragraphs:[{id:'p',text:'正文'}]}]};
afterEach(()=>vi.unstubAllGlobals());
it('原版只有真实原件及来源时可用，无原件历史数据不丢失',()=>{
 expect(originalEpubAvailable(book)).toBe(true);expect(originalEpubAvailable({...book,edition:undefined})).toBe(false);
 expect(originalReaderKind({...book,edition:{...book.edition!,hasOriginalFile:false}})).toBeNull();
 expect(originalReaderKind({...book,edition:{...book.edition!,fileType:'.pdf'},chapters:[]})).toBe('pdf');
 expect(originalReaderKind({...book,edition:{...book.edition!,fileType:'.txt'}})).toBeNull();
});
it.each(['fb2','.FB2','fbz','.FBZ','fb2.zip','.FB2.ZIP'])('%s保留原版格式判定',format=>{
 const value={...book,edition:{...book.edition!,fileType:format},chapters:[{id:'fb',title:'书',sourceHref:'fb2-v1/section-0.xhtml',paragraphs:[]}]};
 expect(originalReaderKind(value)).toBe('fb2');expect(originalReaderKind({...value,editionId:undefined})).toBeNull();
});
it('MOBI、CBZ、UMD原版入口和转换身份不受精读移除影响',()=>{
 expect(originalReaderKind({...book,edition:{...book.edition!,fileType:'.mobi'},chapters:[{...book.chapters[0],sourceHref:'mobi-v1/mobi/0'}]})).toBe('mobi');
 expect(originalReaderKind({...book,edition:{...book.edition!,fileType:'.cbz'},chapters:[{...book.chapters[0],sourceHref:'cbz-v1/1.jpg',paragraphs:[]}]})).toBe('cbz');
 const umd={...book,edition:{...book.edition!,fileType:'.umd',originalHash:'a'.repeat(64),conversion:{format:'.epub' as const,sourceHash:'a'.repeat(64),fileHash:'b'.repeat(64),fileSize:100,converterVersion:'umd-epub-v1' as const,createdAt:'now'}},chapters:[{...book.chapters[0],sourceHref:'OPS/chapter-0001.xhtml'}]};
 expect(originalReaderKind(umd)).toBe('umd');
});
it('单视图不提供精读按钮或可切换模式，有原件始终原版，切书不保留text选择',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 function Harness({value}:{value:LibraryBookContent}){const mode=useReaderMode(value);return <><ReaderFormatStatus book={value}/><output>{mode.original?'original':'historical-text'}</output></>;}
 try{
  await act(async()=>root.render(<Harness value={book}/>));expect(host.querySelectorAll('button')).toHaveLength(0);expect(host.textContent).toBe('原书排版original');
  await act(async()=>root.render(<Harness value={{...book,edition:{...book.edition!,hasOriginalFile:false}}}/>));expect(host.textContent).toContain('历史正文');
  await act(async()=>root.render(<Harness value={book}/>));expect(host.textContent).toBe('原书排版original');
 }finally{await act(async()=>root.unmount());}
});
