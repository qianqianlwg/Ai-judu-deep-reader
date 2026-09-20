// @vitest-environment jsdom
// Independent control-flow probes. Foliate is mocked; these are NOT real-browser rendering evidence.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createHash, webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { EpubReader, type EpubReaderProps } from './epub-reader';
import { DEFAULT_READING_APPEARANCE } from '@/lib/reading-appearance';
import { convertedPositionKey, originalPositionKey } from '@/lib/epub-position';
import type { FoliateBook, FoliateView } from '@/lib/foliate-types';
const loaders=vi.hoisted(()=>({loadEpub:vi.fn(),createFoliateView:vi.fn()}));
vi.mock('@/lib/epub-loader',()=>loaders);
const fb2=vi.hoisted(()=>({loadFb2:vi.fn()}));vi.mock('@/lib/fb2-loader',()=>fb2);
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(v:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
let host:HTMLDivElement,root:Root,props:EpubReaderProps;
function variant(name:string){
 const bytes=new TextEncoder().encode('bounded audit bytes '+name).buffer;
 const fileHash=createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
 const doc=document.implementation.createHTMLDocument(name);doc.body.innerHTML='<p>第一段😀原文</p><p>第二段</p>';
 const raw=document.createElement('div'),renderer=document.createElement('div');raw.dataset.auditView=name;
 Object.assign(renderer,{setStyles:vi.fn(),goTo:vi.fn(async(target:{anchor:(d:Document)=>unknown})=>{target.anchor(doc)}),getContents:()=>[{doc,index:0}]});
 Object.assign(raw,{renderer,open:vi.fn(async()=>{}),init:vi.fn(async()=>{raw.dispatchEvent(new CustomEvent('load',{detail:{doc,index:0}}))}),next:vi.fn(async()=>{}),prev:vi.fn(async()=>{}),close:vi.fn(),getCFI:()=> 'epubcfi(/6/2!/4/1:1)',resolveCFI:vi.fn(()=>({index:0,anchor:(d:Document)=>d.body})),lastLocation:{cfi:'epubcfi(/6/2!/4/1:1)'}});
 const view=raw as unknown as FoliateView;
 const fbook:FoliateBook={sections:[{id:'OPS/chapter-0001.xhtml',createDocument:vi.fn(async()=>doc),load:async()=>null,unload:()=>{}}],destroy:vi.fn(),toc:[]};
 const book:EpubReaderProps['book']={id:'same-book',title:name,author:'audit',editionId:'same-edition',edition:{id:'same-edition',fileName:'audit.umd',fileType:'.umd',hasOriginalFile:true,fileSize:627,originalHash:'a'.repeat(64),createdAt:'now',conversion:{format:'.epub',sourceHash:'a'.repeat(64),fileHash,fileSize:bytes.byteLength,converterVersion:'umd-epub-v1',createdAt:'now'}},chapters:[{id:'c',title:'章',sourceHref:'OPS/chapter-0001.xhtml',paragraphs:[{id:'p',text:'第一段😀原文'},{id:'p2',text:'第二段'}]}]};
 const response={ok:true,arrayBuffer:async()=>bytes} as Response;
 return {book,doc,view,fbook,bytes,response};
}
function queue(v:ReturnType<typeof variant>){vi.mocked(fetch).mockResolvedValueOnce(v.response);loaders.loadEpub.mockResolvedValueOnce(v.fbook);loaders.createFoliateView.mockResolvedValueOnce(v.view)}
async function render(next:Partial<EpubReaderProps>){props={...props,...next};await act(async()=>{root.render(<EpubReader {...props}/>)})}
async function ready(v:ReturnType<typeof variant>){await act(async()=>{await vi.waitFor(()=>expect(v.view.init).toHaveBeenCalled())});await act(async()=>{});expect(host.querySelector('[data-audit-view="'+v.book.title+'"]')).toBe(v.view);expect(host.querySelector('section')?.getAttribute('aria-busy')).toBe('false');expect(host.querySelector('[role="alert"]')).toBeNull()}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn());vi.spyOn(console,'error').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);const initial=variant('seed');props={book:initial.book,anchor:null,appearance:DEFAULT_READING_APPEARANCE,annotations:[],concepts:[],onSelect:vi.fn(),onStartSelection:vi.fn(),onClearSelection:vi.fn(),onPosition:vi.fn(),onNotice:vi.fn(),onFallback:vi.fn()}});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetAllMocks()});
it('late body bytes from the previous derived hash cannot replace current book',async()=>{
 const a=variant('A'),b=variant('B'),body=deferred<ArrayBuffer>();vi.mocked(fetch).mockResolvedValueOnce({ok:true,arrayBuffer:()=>body.promise} as Response);queue(b);
 await render({book:a.book});await render({book:b.book});await ready(b);await act(async()=>body.resolve(a.bytes));expect(loaders.loadEpub).toHaveBeenCalledOnce();expect(host.querySelector('[data-audit-view]')).toBe(b.view);expect(host.querySelector('[role="alert"]')).toBeNull();expect(fb2.loadFb2).not.toHaveBeenCalled();
});
it('late decoded previous book is destroyed without creating a stale view',async()=>{
 const a=variant('A'),b=variant('B'),decoded=deferred<FoliateBook>();vi.mocked(fetch).mockResolvedValueOnce(a.response);loaders.loadEpub.mockReturnValueOnce(decoded.promise);
 await render({book:a.book});await act(async()=>{await vi.waitFor(()=>expect(loaders.loadEpub).toHaveBeenCalledOnce())});queue(b);await render({book:b.book});await ready(b);await act(async()=>decoded.resolve(a.fbook));expect(a.fbook.destroy).toHaveBeenCalledOnce();expect(loaders.createFoliateView).toHaveBeenCalledOnce();expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('late view.open failure cannot fail the replacement hash session',async()=>{
 const a=variant('A'),b=variant('B'),open=deferred<void>();vi.mocked(a.view.open).mockReturnValueOnce(open.promise);queue(a);queue(b);
 await render({book:a.book});await act(async()=>{await vi.waitFor(()=>expect(a.view.open).toHaveBeenCalledOnce())});await render({book:b.book});await ready(b);await act(async()=>open.reject(new Error('old open failed')));expect(host.querySelector('[role="alert"]')).toBeNull();expect(a.view.close).toHaveBeenCalledOnce();
});
it('stale anchor document failure must not put the new converted edition into an error state',async()=>{
 const a=variant('A'),b=variant('B'),documentWork=deferred<Document>();queue(a);queue(b);await render({book:a.book});await ready(a);
 vi.mocked(a.fbook.sections[0].createDocument).mockReturnValueOnce(documentWork.promise);
 await render({anchor:{paragraphId:'p',offset:1}});expect(a.fbook.sections[0].createDocument).toHaveBeenCalledOnce();
 await render({book:b.book,anchor:null});await ready(b);await act(async()=>documentWork.reject(new Error('STALE A createDocument rejected after B ready')));
 expect(host.querySelector('[data-audit-view]')).toBe(b.view);expect(host.querySelector('[role="alert"]')?.textContent??'').toBe('');expect(b.view.close).not.toHaveBeenCalled();
});
it('stale next-page failure must not put the replacement hash session into an error state',async()=>{
 const a=variant('A'),b=variant('B'),next=deferred<void>();vi.mocked(a.view.next).mockReturnValueOnce(next.promise);queue(a);queue(b);await render({book:a.book});await ready(a);
 const button=[...host.querySelectorAll('button')].find(v=>v.textContent==='转换版下一页')!;await act(async()=>button.click());expect(a.view.next).toHaveBeenCalledOnce();
 await render({book:b.book});await ready(b);await act(async()=>next.reject(new Error('STALE A next rejected after B ready')));expect(host.querySelector('[role="alert"]')?.textContent??'').toBe('');
});
it('late successful old navigation must not overwrite the current converted position',async()=>{
 const a=variant('A'),b=variant('B'),go=deferred<void>();queue(a);queue(b);await render({book:a.book});await ready(a);vi.mocked(a.view.renderer.goTo).mockReturnValueOnce(go.promise);
 await render({anchor:{paragraphId:'p',offset:1}});expect(a.view.renderer.goTo).toHaveBeenCalledOnce();await render({book:b.book,anchor:null});await ready(b);
 await act(async()=>{b.view.renderer.dispatchEvent(new CustomEvent('relocate',{detail:{reason:'page'}}));b.view.dispatchEvent(new CustomEvent('relocate',{detail:{index:0,cfi:'epubcfi(/6/2!/4/1:2)'}}));});
 const current=localStorage.getItem(convertedPositionKey('same-edition'))!;expect(JSON.parse(current).fileHash).toBe(b.book.edition!.conversion!.fileHash);
 await act(async()=>go.resolve());expect(localStorage.getItem(convertedPositionKey('same-edition'))).toBe(current);expect(localStorage.getItem(originalPositionKey('same-edition'))).toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('matching hashes cannot restore a CFI outside the current Foliate book sections',async()=>{
 const a=variant('A');queue(a);vi.mocked(a.view.resolveCFI).mockReturnValueOnce({index:99,anchor:d=>d.body});const c=a.book.edition!.conversion!;localStorage.setItem(convertedPositionKey('same-edition'),JSON.stringify({version:1,kind:'umd-epub',sourceHash:c.sourceHash,fileHash:c.fileHash,converterVersion:c.converterVersion,cfi:'epubcfi(/6/2!/4/1:1)',anchor:null}));
 await render({book:a.book});await ready(a);expect(a.view.init).toHaveBeenCalledExactlyOnceWith({showTextStart:true});expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('位置已失效'));
});

it('stale saved-CFI init failure must not retry a closed view or publish a notice to the replacement',async()=>{
 const a=variant('A'),b=variant('B'),init=deferred<void>();vi.mocked(a.view.init).mockReturnValueOnce(init.promise);queue(a);queue(b);const c=a.book.edition!.conversion!;
 localStorage.setItem(convertedPositionKey('same-edition'),JSON.stringify({version:1,kind:'umd-epub',sourceHash:c.sourceHash,fileHash:c.fileHash,converterVersion:c.converterVersion,cfi:'epubcfi(/6/2!/4/1:1)',anchor:null}));
 await render({book:a.book});await act(async()=>{await vi.waitFor(()=>expect(a.view.init).toHaveBeenCalledOnce())});await render({book:b.book});await ready(b);vi.mocked(props.onNotice).mockClear();
 await act(async()=>init.reject(new Error('STALE A saved CFI init failed')));expect(a.view.init).toHaveBeenCalledOnce();expect(props.onNotice).not.toHaveBeenCalled();
});
it('late initial canonical navigation must not resurrect a closed old session after replacement is ready',async()=>{
 const a=variant('A'),b=variant('B'),documentWork=deferred<Document>();a.fbook.toc=[{label:'OLD_A_TOC',href:'OPS/chapter-0001.xhtml'}];b.fbook.toc=[{label:'CURRENT_B_TOC',href:'OPS/chapter-0001.xhtml'}];vi.mocked(a.fbook.sections[0].createDocument).mockReturnValueOnce(documentWork.promise);queue(a);queue(b);
 await render({book:a.book,anchor:{paragraphId:'p',offset:1}});await act(async()=>{await vi.waitFor(()=>expect(a.fbook.sections[0].createDocument).toHaveBeenCalledOnce())});
 await render({book:b.book,anchor:null});await ready(b);expect(host.textContent).toContain('CURRENT_B_TOC');await act(async()=>documentWork.resolve(a.doc));
 expect(host.querySelector('[data-audit-view]')).toBe(b.view);expect(host.textContent).toContain('CURRENT_B_TOC');expect(host.textContent).not.toContain('OLD_A_TOC');
});

it('stale table-of-contents navigation failure cannot fail the replacement session',async()=>{
 const a=variant('A'),b=variant('B'),navigation=deferred<void>();a.fbook.toc=[{label:'A章',href:'OPS/chapter-0001.xhtml'}];a.fbook.resolveHref=()=>({index:0,anchor:d=>d.body});vi.mocked(a.view.renderer.goTo).mockReturnValueOnce(navigation.promise);queue(a);queue(b);
 await render({book:a.book});await ready(a);const select=host.querySelector('select')!;
 await act(async()=>{select.value='OPS/chapter-0001.xhtml';select.dispatchEvent(new Event('change',{bubbles:true}))});expect(a.view.renderer.goTo).toHaveBeenCalledOnce();
 await render({book:b.book});await ready(b);await act(async()=>navigation.reject(new Error('stale table of contents')));expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('a superseded anchor request in the same session cannot fail the current anchor',async()=>{
 const a=variant('A'),older=deferred<Document>();queue(a);await render({book:a.book});await ready(a);vi.mocked(a.fbook.sections[0].createDocument).mockReturnValueOnce(older.promise);
 await render({anchor:{paragraphId:'p',offset:1}});expect(a.fbook.sections[0].createDocument).toHaveBeenCalledOnce();await render({anchor:{paragraphId:'p2',offset:1}});
 expect(JSON.parse(localStorage.getItem(convertedPositionKey('same-edition'))!).anchor).toEqual({paragraphId:'p2',offset:1});
 await act(async()=>older.reject(new Error('superseded anchor')));expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelector('[data-audit-view]')).toBe(a.view);
});
