// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SemanticReadingResult} from './semantic-reading-result';
import type {SemanticUnit} from '@/lib/semantic-reading';
const unit:SemanticUnit={id:'u',label:'一个意思',action:'read',reason:'',anchor:{paragraphId:'p',startOffset:1,endOffset:3,selectedText:'甲。'},status:'completed',content:'对应释读'};
describe('语义结果展示',()=>{it('显示独立定位与范围',()=>{const html=renderToStaticMarkup(<SemanticReadingResult state={{version:1,phase:'completed',units:[unit]}} onOpenSource={()=>{}}/>);expect(html).toContain('对应释读');expect(html).toContain('data-message-id="u"');expect(html).toContain('定位原文');});it('略过明确说明且可以要求句读，不伪装成解释',()=>{const html=renderToStaticMarkup(<SemanticReadingResult state={{version:1,phase:'completed',units:[{...unit,action:'skip',status:'skipped',content:'',reason:'原文直白'}]}} onReadUnit={()=>{}}/>);expect(html).toContain('仍然句读');expect(html).toContain('原文直白');expect(html).toContain('Agent 建议略过');expect(html).not.toContain('对应释读');});});
