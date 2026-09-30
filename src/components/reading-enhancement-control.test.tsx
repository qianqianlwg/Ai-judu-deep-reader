// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {ReadingEnhancementControl} from './reading-enhancement-control';
import {DEFAULT_READING_APPEARANCE} from '@/lib/reading-appearance';
it('四个独立开关、默认与禁止修改，说明不额外调用模型',async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),change=vi.fn();try{await act(async()=>root.render(<ReadingEnhancementControl value={DEFAULT_READING_APPEARANCE} onChange={change}/>));for(const key of ['sourceTerms','sourceSentences','semanticTerms','semanticSentences'] as const){const input=host.querySelector<HTMLInputElement>('[name="'+key+'"]')!;expect(input.checked).toBe(DEFAULT_READING_APPEARANCE[key]);await act(async()=>input.click());expect(change).toHaveBeenLastCalledWith({[key]:!DEFAULT_READING_APPEARANCE[key]});}expect(host.textContent).toContain('不额外调用模型');await act(async()=>root.render(<ReadingEnhancementControl value={DEFAULT_READING_APPEARANCE} onChange={change} disabled/>));expect(host.querySelector('fieldset')?.disabled).toBe(true);}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}});
