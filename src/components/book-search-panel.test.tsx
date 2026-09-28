// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';import {BookSearchPanel} from './book-search-panel';
vi.mock('./vector-index-controls',()=>({VectorIndexControls:()=> <span className="vector-index-controls">向量索引</span>}));
it('搜索方式与原文结果回调可用',async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),onResult=vi.fn();const result={paragraphId:'p',chapterId:'c',chapterTitle:'章',excerpt:'正文'};await act(async()=>root.render(<BookSearchPanel query="正文" onQuery={()=>{}} retrieval="keyword" onRetrieval={()=>{}} status={null} results={[result]} onSearch={()=>{}} onReady={()=>{}} onResult={onResult}/>));expect(host.querySelectorAll('.book-search-modes button')).toHaveLength(3);await act(async()=>host.querySelector<HTMLButtonElement>('.search-results button')!.click());expect(onResult).toHaveBeenCalledWith(result);act(()=>root.unmount());vi.unstubAllGlobals();});

it('默认不挂载语义授权，语义设置展开后才显示准备控件',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),search=vi.fn();
 await act(async()=>root.render(<BookSearchPanel editionId="e" query="" onQuery={()=>{}} retrieval="keyword" onRetrieval={()=>{}} status={{backend:'sqlite',editionId:'e',paragraphCount:50,indexedCount:0,vectorIndexed:false,note:'技术索引信息'}} results={[]} onSearch={search} onReady={()=>{}} onResult={()=>{}}/>));
 expect(host.textContent).not.toContain('向量索引');expect(host.textContent).not.toContain('技术索引信息');expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
 await act(()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(search).not.toHaveBeenCalled();
 const options=host.querySelector<HTMLDetailsElement>('.book-search-options')!;await act(async()=>{options.open=true;options.dispatchEvent(new Event('toggle'));});expect(host.textContent).toContain('向量索引');
 await act(()=>root.unmount());vi.unstubAllGlobals();
});

it('点语义检索直接打开准备入口，未授权不提交，准备完成后可搜索',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),onRetrieval=vi.fn(),onSearch=vi.fn();
 const base={editionId:'e',query:'按含义查找',onQuery:vi.fn(),retrieval:'keyword',onRetrieval,status:{backend:'sqlite' as const,editionId:'e',paragraphCount:3,indexedCount:3,vectorIndexed:false,note:''},results:[],onSearch,onReady:vi.fn(),onResult:vi.fn(),expanded:true};
 await act(async()=>root.render(<BookSearchPanel {...base}/>));
 expect(host.querySelector('.vector-index-controls')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-retrieval="semantic"]')!.click());
 expect(onRetrieval).toHaveBeenCalledWith('semantic');expect(host.querySelector('.vector-index-controls')).not.toBeNull();
 await act(async()=>root.render(<BookSearchPanel {...base} retrieval="semantic"/>));
 expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
 await act(async()=>root.render(<BookSearchPanel {...base} retrieval="semantic" status={{...base.status,vectorIndexed:true}}/>));
 expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
 await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(onSearch).toHaveBeenCalledOnce();
 await act(async()=>root.unmount());vi.unstubAllGlobals();
});
