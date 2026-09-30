// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EnhancedSourceExcerpt,SourceEnhancedText} from './source-enhanced-text';
it('原文增强只加展示标记，保留字面文本且不执行HTML',()=>{const text='权责关系。地方政府承担公共服务，并在行政层级之间协调资源和职责。<script>x</script>';const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<EnhancedSourceExcerpt text={text} ranges={[{start:5,end:15,kind:"key_sentence"}]}/>);expect(host.textContent).toBe(text);expect(host.querySelector('script')).toBeNull();expect(host.querySelector('[data-source-emphasis="key_sentence"]')).not.toBeNull();});
it('原段落范围可投影到页内片段，不改变字序',()=>{const html=renderToStaticMarkup(<SourceEnhancedText text="乙丙丁" start={1} ranges={[{start:0,end:3,kind:'key_sentence'}]}/>);expect(html).toBe('<span data-source-emphasis="key_sentence">乙丙</span>丁');});
