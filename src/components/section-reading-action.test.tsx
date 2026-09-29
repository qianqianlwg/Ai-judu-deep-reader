// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SectionReadingAction} from './section-reading-action';
const chapter={id:'c',title:'标题',paragraphs:[{id:'p',text:'正文'}]};
describe('本节入口',()=>{it('有已有记录则查看，避免重复生成',()=>{expect(renderToStaticMarkup(<SectionReadingAction chapter={chapter} onStart={()=>{}} onOpenExisting={()=>{}}/>)).toContain('查看本节句读');});it('无文字不提供伪句读',()=>{expect(renderToStaticMarkup(<SectionReadingAction chapter={{...chapter,paragraphs:[]}} onStart={()=>{}}/>)).toBe('');});});
